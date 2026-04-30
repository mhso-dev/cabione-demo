import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createBlockedTemplateFromInspection, inspectDwgBuffer, normalizeId } from '../../src/track-b/direct-dwg-inspection.js';

const root = process.cwd();
const samplesDir = join(root, 'samples');
const evidenceDir = join(root, 'data/cad-evidence');
const templateDir = join(root, 'data/draft-templates');
const manifestDir = join(root, 'data/cad-manifests');
const runtimeDataDir = join(root, 'src/data');
const runtimeTemplateDir = join(runtimeDataDir, 'templates');

await mkdir(evidenceDir, { recursive: true });
await mkdir(templateDir, { recursive: true });
await mkdir(manifestDir, { recursive: true });
await mkdir(runtimeTemplateDir, { recursive: true });
await cleanJsonDir(evidenceDir);
await cleanGeneratedTemplateDir(templateDir);
await cleanRuntimeSampleTemplates(runtimeTemplateDir);


async function cleanJsonDir(dir) {
  for (const name of await readdir(dir)) {
    if (name.endsWith('.json')) await rm(join(dir, name));
  }
}

async function cleanGeneratedTemplateDir(dir) {
  for (const name of await readdir(dir)) {
    if (name.endsWith('.json') && !name.endsWith('.draft-template.json')) await rm(join(dir, name));
  }
}

const toolProbe = probeTools(['dwgread', 'dwg2dxf', 'dwglayers', 'dwggrep', 'ODAFileConverter', 'qcad']);
toolProbe.directDwgReader = { package: '@node-projects/acad-ts', available: true, mode: 'direct_dwg_binary_parse' };
toolProbe.semanticExtractionAvailable = true;
const files = await readdir(samplesDir);
const dwgFiles = files.filter((name) => extname(name).toLowerCase() === '.dwg').sort((a, b) => a.localeCompare(b, 'ko'));

const entries = [];
const runtimeEntries = [];
for (const fileName of dwgFiles) {
  const filePath = join(samplesDir, fileName);
  const buffer = await readFile(filePath);
  const inspection = inspectDwgBuffer(buffer, `samples/${fileName}`);
  const base = basename(fileName, extname(fileName));
  const assets = {
    dwg: `samples/${fileName}`,
    pdf: await optionalAsset(`${base}.pdf`),
    png: await optionalAsset(`${base}_1.png`),
  };
  const template = createBlockedTemplateFromInspection(inspection, assets, toolProbe);
  const evidencePath = `data/cad-evidence/${template.id}.json`;
  const templatePath = `data/draft-templates/${template.id}.json`;
  const runtimeTemplatePath = `src/data/templates/${template.id}.json`;
  const evidence = {
    schemaVersion: 1,
    sampleId: template.id,
    templateId: template.id,
    sourceFiles: assets,
    fileHashSha256: inspection.sha256,
    dwgVersionSignature: inspection.header.signature,
    dwgExtractionStatus: template.dwgExtractionStatus,
    sourceEvidence: {
      dwg: {
        path: assets.dwg,
        fileHashSha256: inspection.sha256,
        dwgVersionSignature: inspection.header.signature,
        dwgExtractionStatus: template.dwgExtractionStatus,
        directInspection: true,
        entityCount: inspection.semanticExtraction?.entityCount ?? 0,
        dimensionCount: inspection.semanticExtraction?.dimensions?.extractedCount ?? 0
      }
    },
    inspection,
    drawingInfo: template.drawingInfo,
    toolProbe,
    filenameOnlyInferenceForbidden: true
  };
  await writeJson(join(root, evidencePath), evidence);
  await writeJson(join(root, templatePath), template);
  await writeJson(join(root, runtimeTemplatePath), await createRuntimeTemplate(template, assets, inspection, toolProbe, evidencePath));
  entries.push({
    id: template.id,
    displayName: template.displayName,
    evidencePath,
    templatePath,
    dwgExtractionStatus: template.dwgExtractionStatus,
    directInspection: true,
    entityCount: inspection.semanticExtraction?.entityCount ?? 0,
    dimensionCount: inspection.semanticExtraction?.dimensions?.extractedCount ?? 0,
    textCount: inspection.semanticExtraction?.texts?.length ?? 0,
  });
  runtimeEntries.push({
    templateId: template.id,
    familyId: familyIdFromSampleName(template.displayName),
    familyDisplayName: familyLabelFromSampleName(template.displayName),
    displayName: template.displayName.normalize('NFC'),
    path: runtimeTemplatePath,
    reviewStatus: 'needs_review',
    dwgExtractionStatus: template.dwgExtractionStatus,
    entityCount: inspection.semanticExtraction?.entityCount ?? 0,
    dimensionCount: inspection.semanticExtraction?.dimensions?.extractedCount ?? 0,
    sourceFiles: assets,
  });
}

const manifest = {
  schemaVersion: 1,
  track: 'B',
  generatedAt: new Date().toISOString(),
  sampleCount: entries.length,
  filenameOnlyInferenceForbidden: true,
  toolProbe,
  entries,
  templates: consultationTemplates(),
};
await writeJson(join(manifestDir, 'index.json'), {
  ...manifest,
  schema_version: 'track-b-index.v1',
  sample_count: entries.length,
  manifests: entries.map((entry) => entry.evidencePath),
  draft_templates: entries.map((entry) => entry.templatePath),
  family_templates: familyTemplateMap(entries),
});
await writeJson(join(root, 'src/data/trackBTemplateManifest.json'), manifest);
await writeJson(join(runtimeDataDir, 'templateManifest.json'), {
  schemaVersion: 1,
  generatedBy: 'tools/cad-extract/inspect-dwg-samples.mjs',
  generatedAt: new Date().toISOString(),
  consultationGradeOnly: true,
  productionCadReady: false,
  sampleCount: runtimeEntries.length,
  familyCount: new Set(runtimeEntries.map((entry) => entry.familyId)).size,
  templates: runtimeEntries,
  cadEvidence: entries.map((entry) => entry.evidencePath),
  toolProbe,
  evidencePolicy: 'DWG/PDF/PNG files are paired and directly inspected as files. Cabinet dimensions/options not extracted from DWG entities remain needs_review or blocker and are not DWG-derived.',
});
console.log(JSON.stringify({ ok: true, sampleCount: entries.length, evidenceDir, templateDir, semanticExtractionAvailable: toolProbe.semanticExtractionAvailable, directDwgReader: toolProbe.directDwgReader }, null, 2));

async function optionalAsset(name) {
  const path = join(samplesDir, name);
  try {
    await access(path, constants.R_OK);
    return `samples/${name}`;
  } catch {
    return null;
  }
}

async function cleanRuntimeSampleTemplates(dir) {
  for (const name of await readdir(dir)) {
    if (name.endsWith('.json') && !name.startsWith('track-a-')) await rm(join(dir, name));
  }
}

async function createRuntimeTemplate(blockedTemplate, assets, inspection, toolProbe, evidencePath) {
  const displayName = blockedTemplate.displayName.normalize('NFC');
  const familyId = familyIdFromSampleName(displayName);
  const familyDisplayName = familyLabelFromSampleName(displayName);
  const rule = runtimeFamilyRules()[familyId];
  const inferred = inferSampleDefaults(displayName, rule.defaults, familyId, blockedTemplate.drawingInfo?.dimensions?.roleCandidates, rule.constraints);
  return {
    schemaVersion: 1,
    templateId: blockedTemplate.id,
    sampleId: blockedTemplate.id,
    familyId,
    familyDisplayName,
    displayName,
    reviewStatus: 'needs_review',
    consultationGradeOnly: true,
    productionCadReady: false,
    uiReady: true,
    defaults: {
      dimensions: inferred.dimensions,
      options: inferred.options,
    },
    visualAnnotations: {
      hingePositionNotation: {
        value: familyId === 'sliding_cabinet' ? 'not_applicable' : 'side_marks_indicate_hinge_positions',
        displayName: familyId === 'sliding_cabinet' ? '슬라이딩장은 경첩 표시 없음' : '측면 표시는 경첩 위치',
        sourceKind: 'user_labeled_reference',
        reviewStatus: 'needs_review',
        mechanicallyCertain: false,
        referenceImage: 'KakaoTalk_Photo_2026-04-29-18-32-13.png',
        note: '사용자 제공 KakaoTalk 이미지에서 측면 표시가 경첩 위치라고 확인됨. DWG entity 추출값은 아니므로 needs_review로 유지합니다.',
      },
      doorOpeningDirectionNotation: {
        value: familyId === 'sliding_cabinet' ? 'not_applicable' : 'dashed_diagonal_lines_indicate_door_opening_direction',
        displayName: familyId === 'sliding_cabinet' ? '슬라이딩장은 여닫이 열림 방향 표시 없음' : '점선/사선은 문 열림 방향',
        sourceKind: 'user_labeled_reference_and_png_visual_review',
        reviewStatus: 'needs_review',
        mechanicallyCertain: false,
        referenceImage: 'KakaoTalk_Photo_2026-04-29-18-32-13.png',
        note: '사용자 확인과 샘플 PNG 육안 검토 기준으로 문짝 내부 점선/사선을 열림 방향 표기로 반영합니다. DWG entity 직접 추출값은 아닙니다.',
      },
    },
    constraints: {
      reviewStatus: 'needs_review',
      sourceKind: 'common_logic_with_sample_file_hints',
      mechanicallyCertain: false,
      note: '상담용 초안 constraint입니다. DWG entity에서 기계적으로 추출된 제조 constraint가 아니므로 needs_review입니다.',
      dimensions: Object.fromEntries(Object.entries(rule.constraints).map(([key, value]) => [key, {
        ...value,
        reviewStatus: 'needs_review',
        sourceKind: 'common_logic',
        mechanicallyCertain: false,
      }])),
      options: {
        ...rule.optionConstraints,
        reviewStatus: 'needs_review',
        sourceKind: 'common_logic_with_filename_hint',
        mechanicallyCertain: false,
      },
    },
    sourceFiles: assets,
    sampleReferences: {
      dwg: {
        path: assets.dwg,
        directInspection: true,
        sha256: inspection.sha256,
        signature: inspection.header.signature,
        versionLabel: inspection.header.versionLabel,
        dwgExtractionStatus: blockedTemplate.dwgExtractionStatus,
        entityCount: inspection.semanticExtraction?.entityCount ?? 0,
        dimensionCount: inspection.semanticExtraction?.dimensions?.extractedCount ?? 0,
        sourceKind: 'dwg_entity',
        reviewStatus: inspection.semanticExtraction?.status === 'entity_extracted' ? 'mechanically_certain' : inspection.header.reviewStatus,
      },
      pdf: assets.pdf ? { path: assets.pdf, sourceKind: 'pdf_visual', reviewStatus: 'needs_review' } : null,
      png: assets.png ? { path: assets.png, sourceKind: 'png_visual', reviewStatus: 'needs_review', imageSize: await pngSize(join(root, assets.png)) } : null,
      hingeLegend: {
        path: 'KakaoTalk_Photo_2026-04-29-18-32-13.png',
        sourceKind: 'user_labeled_reference',
        reviewStatus: 'needs_review',
        note: '측면 표시가 경첩 위치라는 사용자 제공 reference.',
      },
      openingDirectionLegend: {
        path: 'KakaoTalk_Photo_2026-04-29-18-32-13.png',
        sourceKind: 'user_labeled_reference_and_png_visual_review',
        reviewStatus: 'needs_review',
        note: '점선/사선 표시가 문 열림 방향이라는 사용자 제공 reference 및 샘플 PNG 육안 확인.',
      },
    },
    sourceEvidence: {
      manifest: evidencePath,
      dwgExtractionStatus: blockedTemplate.dwgExtractionStatus,
      toolProbe,
      inferredDefaults: inferred.provenance,
    },
    drawingInfo: blockedTemplate.drawingInfo ? {
      entityCounts: blockedTemplate.drawingInfo.entityCounts,
      dimensions: blockedTemplate.drawingInfo.dimensions.roleCandidates,
      texts: blockedTemplate.drawingInfo.texts.map((item) => item.value),
      viewLabels: blockedTemplate.drawingInfo.viewLabels.map((item) => item.value),
      productSelectionSignals: blockedTemplate.drawingInfo.productSelectionSignals,
      sourceKind: 'dwg_entity',
      reviewStatus: 'mechanically_certain',
    } : null,
  };
}

function runtimeFamilyRules() {
  const dimension = (min, max, step, defaultValue) => ({ min, max, step, default: defaultValue });
  return {
    base_cabinet: {
      defaults: { dimensions: { width: 800, height: 720, depth: 560 }, options: { doorCount: 2, mountType: 'legged', flapCount: 0, sliding: false, slidingPanelCount: 0 } },
      constraints: { width: dimension(400, 1500, 10, 800), height: dimension(350, 900, 10, 720), depth: dimension(350, 600, 10, 560) },
      optionConstraints: { doorCount: { min: 1, max: 5 }, mountType: ['legged', 'wall_mounted'], sliding: 'unavailable' },
    },
    wall_cabinet: {
      defaults: { dimensions: { width: 800, height: 600, depth: 170 }, options: { doorCount: 2, mountType: 'wall_mounted', flapCount: 0, sliding: false, slidingPanelCount: 0 } },
      constraints: { width: dimension(300, 1200, 10, 800), height: dimension(300, 900, 10, 600), depth: dimension(120, 250, 10, 170) },
      optionConstraints: { doorCount: { min: 1, max: 4 }, mountType: ['wall_mounted'], sliding: 'unavailable' },
    },
    sliding_cabinet: {
      defaults: { dimensions: { width: 1200, height: 900, depth: 250 }, options: { doorCount: 0, mountType: 'wall_mounted', flapCount: 0, sliding: true, slidingPanelCount: 2 } },
      constraints: { width: dimension(600, 1800, 10, 1200), height: dimension(400, 1200, 10, 900), depth: dimension(120, 350, 10, 250) },
      optionConstraints: { slidingPanelCount: [2, 3], mountType: ['wall_mounted'], sliding: 'required' },
    },
    three_door_cabinet: {
      defaults: { dimensions: { width: 1200, height: 720, depth: 560 }, options: { doorCount: 3, mountType: 'legged', flapCount: 0, sliding: false, slidingPanelCount: 0 } },
      constraints: { width: dimension(900, 1800, 10, 1200), height: dimension(350, 900, 10, 720), depth: dimension(350, 650, 10, 560) },
      optionConstraints: { doorCount: [3], mountType: ['legged', 'wall_mounted'], sliding: 'unavailable' },
    },
    flap_cabinet: {
      defaults: { dimensions: { width: 800, height: 450, depth: 350 }, options: { doorCount: 0, mountType: 'wall_mounted', flapCount: 1, sliding: false, slidingPanelCount: 0 } },
      constraints: { width: dimension(450, 1200, 10, 800), height: dimension(300, 800, 10, 450), depth: dimension(250, 450, 10, 350) },
      optionConstraints: { flapCount: [1, 2], mountType: ['wall_mounted'], sliding: 'unavailable' },
    },
  };
}

function inferSampleDefaults(displayName, defaults, familyId, dimensionCandidates = null, constraints = {}) {
  const dimensions = { ...defaults.dimensions };
  const options = { ...defaults.options };
  const provenance = [];
  const widthCandidate = chooseConstrainedCandidate(dimensionCandidates?.width, constraints.width);
  if (Number.isFinite(widthCandidate)) {
    dimensions.width = widthCandidate;
    provenance.push({ field: 'dimensions.width', value: widthCandidate, sourceKind: 'dwg_entity', reviewStatus: 'needs_review', note: 'DWG dimension entity에서 추출한 폭 후보를 상담용 기본값으로 반영했습니다. 역할 매핑은 needs_review입니다.' });
  } else {
    const widthMatch = displayName.match(/W(\d{3,4})/i);
    if (widthMatch) {
      dimensions.width = Number(widthMatch[1]);
      provenance.push({ field: 'dimensions.width', sourceKind: 'filename_hint', reviewStatus: 'needs_review', note: '파일명 W값을 상담용 기본값으로만 반영했습니다.' });
    }
  }
  const heightCandidate = chooseConstrainedCandidate(dimensionCandidates?.height, constraints.height);
  if (Number.isFinite(heightCandidate)) {
    dimensions.height = heightCandidate;
    provenance.push({ field: 'dimensions.height', value: heightCandidate, sourceKind: 'dwg_entity', reviewStatus: 'needs_review', note: 'DWG dimension entity에서 추출한 높이 후보를 상담용 기본값으로 반영했습니다. 역할 매핑은 needs_review입니다.' });
  }
  const depthCandidate = chooseConstrainedCandidate(dimensionCandidates?.depth, constraints.depth);
  if (Number.isFinite(depthCandidate)) {
    dimensions.depth = depthCandidate;
    provenance.push({ field: 'dimensions.depth', value: depthCandidate, sourceKind: 'dwg_entity', reviewStatus: 'needs_review', note: 'DWG dimension entity에서 추출한 깊이 후보를 상담용 기본값으로 반영했습니다. 역할 매핑은 needs_review입니다.' });
  }
  const doorMatch = displayName.match(/(\d)도어/);
  if (doorMatch && familyId !== 'sliding_cabinet') {
    options.doorCount = Number(doorMatch[1]);
    provenance.push({ field: 'options.doorCount', sourceKind: 'filename_hint', reviewStatus: 'needs_review', note: '파일명의 도어 수 힌트를 상담용 기본값으로만 반영했습니다.' });
  }
  if (displayName.includes('벽걸이')) {
    options.mountType = 'wall_mounted';
    provenance.push({ field: 'options.mountType', sourceKind: 'filename_hint', reviewStatus: 'needs_review' });
  }
  if (displayName.includes('다리')) {
    options.mountType = 'legged';
    provenance.push({ field: 'options.mountType', sourceKind: 'filename_hint', reviewStatus: 'needs_review' });
  }
  return { dimensions, options, provenance };
}


function chooseConstrainedCandidate(candidates = [], constraint = {}) {
  return candidates.find((candidate) => Number.isFinite(candidate)
    && candidate >= (constraint.min ?? Number.NEGATIVE_INFINITY)
    && candidate <= (constraint.max ?? Number.POSITIVE_INFINITY)
    && ((candidate - (constraint.min ?? candidate)) % (constraint.step ?? 1) === 0));
}

async function pngSize(path) {
  try {
    const buffer = await readFile(path);
    if (buffer.subarray(1, 4).toString('ascii') !== 'PNG') return null;
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  } catch {
    return null;
  }
}

function familyIdFromSampleName(value) {
  const normalized = value.normalize('NFC');
  if (normalized.includes('하부장')) return 'base_cabinet';
  if (normalized.includes('상부장')) return 'wall_cabinet';
  if (normalized.includes('슬라이징장')) return 'sliding_cabinet';
  if (normalized.includes('3도어장')) return 'three_door_cabinet';
  if (normalized.includes('플랩장')) return 'flap_cabinet';
  return 'base_cabinet';
}

function familyLabelFromSampleName(value) {
  return {
    base_cabinet: '하부장',
    wall_cabinet: '상부장',
    sliding_cabinet: '슬라이징장',
    three_door_cabinet: '3도어장',
    flap_cabinet: '플랩장',
  }[familyIdFromSampleName(value)];
}



function familyTemplateMap(entries) {
  const map = {
    base_cabinet: [],
    wall_cabinet: [],
    sliding_cabinet: [],
    three_door_cabinet: [],
    flap_cabinet: [],
  };
  for (const entry of entries) {
    const name = entry.displayName.normalize('NFC');
    if (name.includes('하부장')) map.base_cabinet.push(entry.templatePath);
    else if (name.includes('상부장')) map.wall_cabinet.push(entry.templatePath);
    else if (name.includes('슬라이징장')) map.sliding_cabinet.push(entry.templatePath);
    else if (name.includes('3도어장')) map.three_door_cabinet.push(entry.templatePath);
    else if (name.includes('플랩장')) map.flap_cabinet.push(entry.templatePath);
  }
  return map;
}

function consultationTemplates() {
  const dimension = (min, max, step, value) => ({ min, max, step, default: value, review_status: 'needs_review' });
  return [
    consultationTemplate('track-a-base-cabinet', '하부장', { width: dimension(300, 2400, 50, 800), height: dimension(600, 900, 10, 720), depth: dimension(450, 700, 10, 580) }, { doorCount: 2, sliding: false }),
    consultationTemplate('track-a-wall-cabinet', '상부장', { width: dimension(300, 1800, 50, 800), height: dimension(300, 900, 10, 700), depth: dimension(250, 450, 10, 350) }, { doorCount: 2, sliding: false }),
    consultationTemplate('track-a-sliding-cabinet', '슬라이징장', { width: dimension(900, 2400, 50, 1600), height: dimension(1800, 2400, 10, 2100), depth: dimension(450, 700, 10, 600) }, { panelCount: 2, sliding: true }),
    consultationTemplate('track-a-three-door-cabinet', '3도어장', { width: dimension(900, 1800, 50, 1200), height: dimension(600, 2200, 10, 1800), depth: dimension(450, 650, 10, 550) }, { doorCount: 3, sliding: false }),
    consultationTemplate('track-a-flap-cabinet', '플랩장', { width: dimension(450, 1800, 50, 900), height: dimension(250, 700, 10, 400), depth: dimension(250, 500, 10, 350) }, { flapCount: 1, sliding: false }),
  ];
}

function consultationTemplate(templateId, family, constraints, options) {
  return {
    templateId,
    familyDisplayName: family,
    family,
    reviewStatus: 'needs_review',
    consultationGradeOnly: true,
    productionCadReady: false,
    constraints,
    defaults: {
      dimensions: Object.fromEntries(Object.entries(constraints).map(([key, rule]) => [key, rule.default])),
      options,
    },
  };
}

function probeTools(toolNames) {
  const tools = Object.fromEntries(toolNames.map((tool) => [tool, commandProbe(tool)]));
  return {
    checkedAt: new Date().toISOString(),
    tools,
    semanticExtractionAvailable: Object.values(tools).some((tool) => tool.available),
    directBytesInspection: true,
  };
}

function commandProbe(command) {
  const found = spawnSync('which', [command], { encoding: 'utf8' });
  if (found.status !== 0) return { available: false };
  const version = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 3000 });
  return { available: true, path: found.stdout.trim(), versionOutput: `${version.stdout}${version.stderr}`.trim().slice(0, 500) };
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
