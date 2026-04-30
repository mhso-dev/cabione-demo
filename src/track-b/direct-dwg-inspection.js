import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';
import { DwgReader } from '@node-projects/acad-ts';
import { REVIEW_STATUS, SOURCE_KIND } from '../shared/review-status.js';

const VERSION_BY_SIGNATURE = Object.freeze({
  AC1021: 'AutoCAD 2007/2008/2009 DWG',
  AC1032: 'AutoCAD 2018/2019/2020 DWG',
});

const DWG_ENTITY_EXTRACTION_STATUS = Object.freeze({
  ENTITY_EXTRACTED: 'entity_extracted',
  ENTITY_EXTRACTION_FAILED: 'entity_extraction_failed',
});

export function inspectDwgBuffer(buffer, filePath) {
  const signature = buffer.subarray(0, 6).toString('ascii');
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const semanticExtraction = extractDwgSemanticInfo(buffer);
  return {
    filePath,
    fileName: basename(filePath),
    baseName: basename(filePath, extname(filePath)),
    sizeBytes: buffer.length,
    sha256,
    directInspection: true,
    header: {
      signature,
      versionLabel: VERSION_BY_SIGNATURE[signature] ?? 'unknown_or_unsupported_dwg_signature',
      sourceKind: SOURCE_KIND.DWG_HEADER,
      reviewStatus: REVIEW_STATUS.DWG_HEADER_INSPECTED,
    },
    semanticExtraction,
  };
}

export function createBlockedTemplateFromInspection(inspection, assets, toolProbe) {
  const entityExtracted = inspection.semanticExtraction?.status === DWG_ENTITY_EXTRACTION_STATUS.ENTITY_EXTRACTED;
  const dimensionCandidates = inspection.semanticExtraction?.dimensions?.roleCandidates ?? emptyDimensionCandidates();
  return {
    schemaVersion: 1,
    track: 'B',
    id: normalizeId(inspection.baseName),
    displayName: inspection.baseName,
    sourceAssets: assets,
    dwgInspection: inspection,
    dwgExtractionStatus: entityExtracted ? DWG_ENTITY_EXTRACTION_STATUS.ENTITY_EXTRACTED : REVIEW_STATUS.BLOCKED_BY_TOOLING,
    blocker: entityExtracted ? null : 'No DWG entity reader was able to extract semantic drawing entities during this run.',
    values: {
      familyHint: {
        value: inferWeakFamilyHint(inspection.baseName),
        sourceKind: SOURCE_KIND.FILENAME_HINT,
        reviewStatus: REVIEW_STATUS.NEEDS_REVIEW,
        note: 'Weak filename hint only; not accepted as direct DWG entity evidence.',
      },
      dimensions: {
        width: dimensionValueFromCandidates(dimensionCandidates.width, 'width'),
        height: dimensionValueFromCandidates(dimensionCandidates.height, 'height'),
        depth: dimensionValueFromCandidates(dimensionCandidates.depth, 'depth'),
      },
      productSelectionSignals: inspection.semanticExtraction?.productSelectionSignals ?? [],
    },
    drawingInfo: entityExtracted ? {
      sourceKind: SOURCE_KIND.DWG_ENTITY,
      reviewStatus: REVIEW_STATUS.MECHANICALLY_CERTAIN,
      entityCounts: inspection.semanticExtraction.entityCounts,
      layers: inspection.semanticExtraction.layers,
      texts: inspection.semanticExtraction.texts,
      dimensions: inspection.semanticExtraction.dimensions,
      bounds: inspection.semanticExtraction.bounds,
      viewLabels: inspection.semanticExtraction.viewLabels,
      supportGeometry: inspection.semanticExtraction.supportGeometry,
      productSelectionSignals: inspection.semanticExtraction.productSelectionSignals,
    } : null,
    filenameOnlyInferenceForbidden: true,
    dwgDerivedValues: entityExtracted ? buildDwgDerivedValueIndex(inspection.semanticExtraction) : [],
  };
}

export function normalizeId(value) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase();
}

export function extractDwgSemanticInfo(buffer) {
  const messages = [];
  try {
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const doc = DwgReader.readFromStream(arrayBuffer, (_sender, event) => {
      messages.push(String(event?.Message ?? event?.message ?? event).slice(0, 500));
    });
    const entities = [...(doc.modelSpace?.entities ?? [])];
    const dimensions = extractDimensions(entities);
    const texts = extractTexts(entities);
    const entityCounts = countBy(entities, (entity) => entity.constructor.name);
    const bounds = calculateBounds(entities);
    const viewLabels = texts.filter((item) => /\b(FRONT|INNER|SIDE)\s+VIEW\b/i.test(item.value));
    const supportGeometry = detectSupportGeometry(entities);
    return {
      status: DWG_ENTITY_EXTRACTION_STATUS.ENTITY_EXTRACTED,
      directInspection: true,
      reader: {
        package: '@node-projects/acad-ts',
        mode: 'direct_dwg_binary_parse',
      },
      warnings: unique(messages),
      document: {
        version: doc.header?.version,
        codePage: doc.header?.codePage,
        measurementUnits: doc.header?.measurementUnits,
        insUnits: doc.header?.insUnits,
        textSize: roundNumber(doc.header?.textSize ?? doc.header?.textHeightDefault),
      },
      layers: extractNamedCollection(doc.layers),
      textStyles: extractNamedCollection(doc.textStyles),
      layouts: extractNamedCollection(doc.layouts),
      blockRecords: summarizeBlocks(doc.blockRecords),
      entityCounts,
      entityCount: entities.length,
      bounds,
      texts,
      viewLabels,
      dimensions,
      supportGeometry,
      productSelectionSignals: buildProductSelectionSignals({ entityCounts, texts, dimensions, viewLabels, supportGeometry }),
    };
  } catch (error) {
    return {
      status: DWG_ENTITY_EXTRACTION_STATUS.ENTITY_EXTRACTION_FAILED,
      directInspection: true,
      reader: { package: '@node-projects/acad-ts', mode: 'direct_dwg_binary_parse' },
      warnings: unique(messages),
      error: String(error?.message ?? error),
    };
  }
}

function extractDimensions(entities) {
  const entries = [];
  for (const entity of entities) {
    if (!entity.constructor.name.includes('Dimension')) continue;
    const first = point(entity.firstPoint);
    const second = point(entity.secondPoint);
    const valueFromGeometry = first && second ? distance(first, second) : null;
    const valueFromText = parseFirstNumber(entity.text);
    const value = roundNumber(valueFromText ?? valueFromGeometry);
    entries.push({
      type: entity.constructor.name,
      handle: entity.handle,
      layer: layerName(entity),
      text: cleanText(entity.text),
      value,
      valueSource: valueFromText == null ? 'dimension_geometry' : 'dimension_text',
      unitAssumption: 'drawing_unit_mm',
      orientation: dimensionOrientation(first, second, entity.rotation),
      firstPoint: first,
      secondPoint: second,
      definitionPoint: point(entity.definitionPoint),
      textMiddlePoint: point(entity.textMiddlePoint),
      sourceKind: SOURCE_KIND.DWG_ENTITY,
      reviewStatus: REVIEW_STATUS.MECHANICALLY_CERTAIN,
    });
  }
  const filtered = entries.filter((entry) => Number.isFinite(entry.value));
  return {
    count: entries.length,
    extractedCount: filtered.length,
    entries: entries.slice(0, 120),
    numericValues: uniqueNumbers(filtered.map((entry) => entry.value)).sort((a, b) => a - b),
    roleCandidates: buildDimensionRoleCandidates(filtered),
    evidenceNote: 'Dimension entity values are read directly from DWG entities. Width/height/depth role assignment remains a candidate unless separately reviewed.',
  };
}

function extractTexts(entities) {
  const values = [];
  for (const entity of entities) {
    if (!/Text|MText/i.test(entity.constructor.name)) continue;
    const value = cleanText(entity.value ?? entity.text ?? entity.contents ?? entity.rawText ?? entity.plainText);
    if (!value) continue;
    values.push({
      type: entity.constructor.name,
      handle: entity.handle,
      layer: layerName(entity),
      value,
      position: point(entity.insertPoint ?? entity.insertionPoint),
      sourceKind: SOURCE_KIND.DWG_ENTITY,
      reviewStatus: REVIEW_STATUS.MECHANICALLY_CERTAIN,
    });
  }
  return values.slice(0, 120);
}

function buildDimensionRoleCandidates(entries) {
  const horizontal = entries.filter((entry) => entry.orientation === 'horizontal').map((entry) => entry.value);
  const vertical = entries.filter((entry) => entry.orientation === 'vertical').map((entry) => entry.value);
  const all = entries.map((entry) => entry.value);
  const usable = (values, min = 80, max = 2400) => uniqueNumbers(values)
    .filter((value) => value >= min && value <= max)
    .sort((a, b) => b - a)
    .slice(0, 12);
  return {
    width: usable(horizontal),
    height: usable(vertical),
    depth: usable([...horizontal, ...vertical], 80, 900).filter((value) => !usable(horizontal).slice(0, 2).includes(value)).slice(0, 12),
    all: usable(all),
    sourceKind: SOURCE_KIND.DWG_ENTITY,
    reviewStatus: REVIEW_STATUS.NEEDS_REVIEW,
    note: 'Candidates are mechanically extracted dimensions, but assigning cabinet roles requires review when multiple views are present.',
  };
}

function calculateBounds(entities) {
  const points = [];
  for (const entity of entities) {
    for (const candidate of entityPoints(entity)) points.push(candidate);
  }
  if (!points.length) return null;
  const xs = points.map((item) => item.x);
  const ys = points.map((item) => item.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    minX: roundNumber(minX),
    minY: roundNumber(minY),
    maxX: roundNumber(maxX),
    maxY: roundNumber(maxY),
    width: roundNumber(maxX - minX),
    height: roundNumber(maxY - minY),
    sourceKind: SOURCE_KIND.DWG_ENTITY,
    reviewStatus: REVIEW_STATUS.MECHANICALLY_CERTAIN,
  };
}

function entityPoints(entity) {
  const points = [];
  for (const key of ['startPoint', 'endPoint', 'center', 'firstPoint', 'secondPoint', 'definitionPoint', 'textMiddlePoint', 'insertPoint', 'insertionPoint']) {
    const candidate = point(entity[key]);
    if (candidate) points.push(candidate);
  }
  for (const vertex of entity.vertices ?? []) {
    const candidate = point(vertex.location ?? vertex);
    if (candidate) points.push(candidate);
  }
  return points;
}

function buildProductSelectionSignals({ entityCounts, texts, dimensions, viewLabels, supportGeometry }) {
  const textValues = texts.map((item) => item.value);
  const signals = [];
  if (viewLabels.length) {
    signals.push(signal('multi_view_labels', viewLabels.map((item) => item.value), 'DWG contains explicit FRONT/INNER/SIDE VIEW labels.'));
  }
  const slidingLabels = textValues.filter((text) => /아웃도어|인도어|out\s*door|in\s*door/i.test(text));
  if (slidingLabels.length) {
    signals.push(signal('sliding_or_inner_outer_door_labels', slidingLabels, 'DWG text includes inner/out-door labels useful for product-family selection.'));
  }
  const mirrorLabels = textValues.filter((text) => /은경|거울|mirror/i.test(text));
  if (mirrorLabels.length) {
    signals.push(signal('mirror_material_labels', unique(mirrorLabels), 'DWG text includes mirror/material labels.'));
  }
  const handleLabels = textValues.filter((text) => /손잡이|handle/i.test(text));
  if (handleLabels.length) {
    signals.push(signal('handle_labels', unique(handleLabels), 'DWG text includes handle option labels.'));
  }
  if (supportGeometry?.legLikePairCount > 0) {
    signals.push(signal('leg_support_geometry', {
      legLikePairCount: supportGeometry.legLikePairCount,
      legLikeSegmentCount: supportGeometry.legLikeSegmentCount,
      candidates: supportGeometry.candidates,
    }, 'DWG line entities include repeated short mirrored slanted support pairs consistent with cabinet legs.'));
  }
  if ((entityCounts.DimensionLinear ?? 0) + (entityCounts.DimensionAligned ?? 0) > 0) {
    signals.push(signal('dimension_entities', {
      count: dimensions.count,
      candidates: dimensions.roleCandidates,
    }, 'DWG dimension entities provide candidate width/height/depth values for selection defaults.'));
  }
  return signals;
}

function detectSupportGeometry(entities) {
  const segments = [];
  for (const entity of entities) {
    if (entity.constructor.name !== 'Line') continue;
    const start = point(entity.startPoint);
    const end = point(entity.endPoint);
    if (!start || !end) continue;
    const dx = Math.abs(end.x - start.x);
    const dy = Math.abs(end.y - start.y);
    const length = Math.sqrt(dx ** 2 + dy ** 2);
    if (dx < 8 || dx > 30 || dy < 70 || dy > 140 || length < 75 || length > 145) continue;
    segments.push({
      type: entity.constructor.name,
      handle: entity.handle,
      layer: layerName(entity),
      startPoint: start,
      endPoint: end,
      dx: roundNumber(dx),
      dy: roundNumber(dy),
      length: roundNumber(length),
      midX: roundNumber((start.x + end.x) / 2),
      midY: roundNumber((start.y + end.y) / 2),
      slopeSign: Math.sign((end.y - start.y) / (end.x - start.x)),
      sourceKind: SOURCE_KIND.DWG_ENTITY,
      reviewStatus: REVIEW_STATUS.NEEDS_REVIEW,
    });
  }

  const pairs = [];
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      const first = segments[i];
      const second = segments[j];
      if (first.slopeSign === second.slopeSign) continue;
      if (Math.abs(first.midY - second.midY) > 5) continue;
      const gap = Math.abs(first.midX - second.midX);
      if (gap < 20 || gap > 80) continue;
      if (Math.abs(first.dy - second.dy) > 5) continue;
      pairs.push({
        segmentHandles: [first.handle, second.handle].filter(Boolean),
        centerX: roundNumber((first.midX + second.midX) / 2),
        centerY: roundNumber((first.midY + second.midY) / 2),
        gap: roundNumber(gap),
      });
    }
  }

  return {
    legLikeSegmentCount: segments.length,
    legLikePairCount: pairs.length,
    candidates: pairs.slice(0, 12),
    sourceKind: SOURCE_KIND.DWG_ENTITY,
    reviewStatus: pairs.length > 0 ? REVIEW_STATUS.NEEDS_REVIEW : REVIEW_STATUS.MECHANICALLY_CERTAIN,
    note: pairs.length > 0
      ? 'Repeated mirrored short slanted line pairs were detected from DWG entities. This is direct geometry evidence for leg-like supports, but semantic assignment remains needs_review.'
      : 'No repeated mirrored short slanted support-pair geometry detected in DWG entities.',
  };
}

function signal(kind, value, note) {
  return {
    kind,
    value,
    note,
    sourceKind: SOURCE_KIND.DWG_ENTITY,
    reviewStatus: REVIEW_STATUS.MECHANICALLY_CERTAIN,
  };
}

function buildDwgDerivedValueIndex(semanticExtraction) {
  const values = [
    {
      field: 'drawingInfo.entityCounts',
      sourceKind: SOURCE_KIND.DWG_ENTITY,
      reviewStatus: REVIEW_STATUS.MECHANICALLY_CERTAIN,
    },
    {
      field: 'drawingInfo.dimensions.entries',
      count: semanticExtraction.dimensions.extractedCount,
      sourceKind: SOURCE_KIND.DWG_ENTITY,
      reviewStatus: REVIEW_STATUS.MECHANICALLY_CERTAIN,
    },
    {
      field: 'drawingInfo.texts',
      count: semanticExtraction.texts.length,
      sourceKind: SOURCE_KIND.DWG_ENTITY,
      reviewStatus: REVIEW_STATUS.MECHANICALLY_CERTAIN,
    },
  ];
  if (semanticExtraction.bounds) {
    values.push({
      field: 'drawingInfo.bounds',
      sourceKind: SOURCE_KIND.DWG_ENTITY,
      reviewStatus: REVIEW_STATUS.MECHANICALLY_CERTAIN,
    });
  }
  return values;
}

function dimensionValueFromCandidates(candidates, role) {
  const value = candidates?.[0] ?? null;
  return {
    value,
    unit: 'mm',
    sourceKind: value == null ? SOURCE_KIND.BLOCKED_BY_TOOLING : SOURCE_KIND.DWG_ENTITY,
    reviewStatus: value == null ? REVIEW_STATUS.BLOCKER : REVIEW_STATUS.NEEDS_REVIEW,
    mechanicallyCertain: false,
    note: value == null
      ? `No ${role} candidate could be extracted from DWG dimension entities.`
      : `Top ${role} candidate from direct DWG dimension entities. Candidate role assignment remains needs_review.`,
  };
}

function emptyDimensionCandidates() {
  return { width: [], height: [], depth: [], all: [] };
}

function summarizeBlocks(collection) {
  const blocks = [];
  for (const item of safeCollection(collection)) {
    blocks.push({
      name: item.name ?? item._name,
      entityCount: countIterable(item.entities),
    });
  }
  return blocks.slice(0, 80);
}

function extractNamedCollection(collection) {
  return safeCollection(collection).map((item) => item.name ?? item._name).filter(Boolean).slice(0, 120);
}

function safeCollection(collection) {
  if (!collection) return [];
  try {
    return [...collection];
  } catch {
    return [];
  }
}

function countIterable(value) {
  if (!value) return 0;
  try {
    return [...value].length;
  } catch {
    return 0;
  }
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function layerName(entity) {
  return entity.layer?.name ?? entity.layer?._name ?? entity._layer?.name ?? entity._layer?._name ?? null;
}

function cleanText(value) {
  if (value == null) return '';
  return String(value).replace(/\\P/g, ' ').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

function parseFirstNumber(value) {
  const match = cleanText(value).match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function dimensionOrientation(first, second, rotation) {
  if (first && second) {
    const dx = Math.abs(second.x - first.x);
    const dy = Math.abs(second.y - first.y);
    if (dx > dy * 2) return 'horizontal';
    if (dy > dx * 2) return 'vertical';
  }
  if (Number.isFinite(rotation)) {
    const normalized = Math.abs(Math.sin(rotation));
    if (normalized > 0.85) return 'vertical';
    if (normalized < 0.15) return 'horizontal';
  }
  return 'angled_or_unknown';
}

function distance(first, second) {
  return Math.sqrt((second.x - first.x) ** 2 + (second.y - first.y) ** 2 + ((second.z ?? 0) - (first.z ?? 0)) ** 2);
}

function point(value) {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
  return {
    x: roundNumber(value.x),
    y: roundNumber(value.y),
    ...(Number.isFinite(value.z) ? { z: roundNumber(value.z) } : {}),
  };
}

function roundNumber(value, precision = 3) {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== '' && value != null))];
}

function uniqueNumbers(values) {
  return unique(values.map((value) => Math.round(value)).filter((value) => Number.isFinite(value)));
}

function inferWeakFamilyHint(baseName) {
  const normalizedBaseName = baseName.normalize('NFC');
  for (const family of ['하부장', '상부장', '슬라이징장', '3도어장', '플랩장']) {
    if (normalizedBaseName.includes(family.normalize('NFC'))) return family;
  }
  return 'unknown';
}
