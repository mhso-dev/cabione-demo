import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const EXPECTED_FAMILIES = new Set(['하부장', '상부장', '슬라이징장', '3도어장', '플랩장']);
const FAMILY_ALIASES = new Map([
  ['base_cabinet', '하부장'],
  ['wall_cabinet', '상부장'],
  ['sliding_cabinet', '슬라이징장'],
  ['three_door_cabinet', '3도어장'],
  ['flap_cabinet', '플랩장'],
  ['lower_cabinet', '하부장'],
  ['upper_cabinet', '상부장'],
]);

function mustExist(relativePath, purpose) {
  const absolutePath = path.join(repoRoot, relativePath);
  assert.ok(existsSync(absolutePath), `${purpose} missing at ${relativePath}`);
  return absolutePath;
}

function readJson(relativePath, purpose = relativePath) {
  const file = mustExist(relativePath, purpose);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${purpose} is not valid JSON (${relativePath}): ${error.message}`);
  }
}

async function importModule(relativePath, purpose) {
  const file = mustExist(relativePath, purpose);
  return import(pathToFileURL(file).href);
}

function normalizeFamily(value) {
  if (!value) return value;
  return FAMILY_ALIASES.get(value) ?? value;
}

function manifestTemplateEntries(manifest) {
  if (Array.isArray(manifest)) return manifest;
  if (Array.isArray(manifest.templates)) return manifest.templates;
  if (Array.isArray(manifest.items)) return manifest.items;
  if (Array.isArray(manifest.records)) return manifest.records;
  if (Array.isArray(manifest.entries)) return manifest.entries;
  throw new Error('template manifest must be an array or expose templates/items/records/entries array');
}

function listJsonFiles(relativeDir) {
  const dir = mustExist(relativeDir, `${relativeDir} directory`);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(relativeDir, name));
}

function optionalJson(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  return existsSync(absolutePath) ? JSON.parse(readFileSync(absolutePath, 'utf8')) : null;
}

function optionalJsonFiles(relativeDir) {
  const dir = path.join(repoRoot, relativeDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(relativeDir, name));
}

function fieldValue(value) {
  if (value && typeof value === 'object' && 'value' in value) return value.value;
  return value;
}

function fieldReviewStatus(value) {
  if (value && typeof value === 'object') return value.review_status ?? value.reviewStatus ?? value.status;
  return undefined;
}

function loadMvpTemplates() {
  const srcManifest = optionalJson('src/data/templateManifest.json');
  if (srcManifest) return manifestTemplateEntries(srcManifest).map(loadTemplateByEntry);

  const trackBIndex = optionalJson('data/cad-manifests/index.json');
  assert.ok(trackBIndex, 'expected src/data/templateManifest.json or data/cad-manifests/index.json');
  const paths = trackBIndex.draft_templates ?? [];
  assert.ok(paths.length >= 18, `Track B index must list at least 18 draft templates, found ${paths.length}`);
  return paths.map((relativePath) => readJson(relativePath, relativePath));
}

async function loadConsultationTemplates() {
  if (existsSync(path.join(repoRoot, 'src/data/templates/track-a-draft-templates.js'))) {
    const mod = await importModule('src/data/templates/track-a-draft-templates.js', 'Track A draft templates');
    assert.ok(Array.isArray(mod.trackADraftTemplates), 'track-a-draft-templates.js must export trackADraftTemplates array');
    return mod.trackADraftTemplates;
  }
  return loadMvpTemplates();
}

function templateFamily(template) {
  return normalizeFamily(fieldValue(template.familyDisplayName ?? template.family ?? template.familyId));
}

function templateReviewStatus(template) {
  return template.reviewStatus ?? template.review_status ?? template.review?.status;
}

function templateConstraints(template) {
  return template.constraints ?? {};
}

function assertDraftConstraintShape(template, family) {
  const constraints = templateConstraints(template);
  const dimensions = template.dimensions ?? constraints.dimensions;
  assert.ok(dimensions ?? constraints, `${family} must define draft constraints`);
  const dimensionKeys = Object.keys(dimensions ?? constraints).filter((key) => /width|height|depth|dimension/i.test(key));
  assert.ok(dimensionKeys.length > 0, `${family} must define width/height/depth draft constraints`);
  const constraintText = JSON.stringify(dimensions ?? constraints);
  assert.match(constraintText, /needs_review/i, `${family} inferred constraints must remain needs_review`);
}

function loadTemplateByEntry(entry) {
  const templatePath = entry.path ?? entry.templatePath ?? entry.file ?? entry.href;
  if (templatePath) return readJson(templatePath, `template ${entry.templateId ?? templatePath}`);
  if (entry.template && typeof entry.template === 'object') return entry.template;
  return entry;
}

function pickTemplate(templates, familyDisplayName) {
  const template = templates.find((candidate) => templateFamily(candidate) === familyDisplayName);
  assert.ok(template, `expected at least one template for family ${familyDisplayName}`);
  return template;
}

function makeProject(template, overrides = {}) {
  const defaults = template.defaults ?? {};
  return {
    projectId: 'test-project',
    templateId: template.templateId,
    family: template.family ?? template.familyId,
    dimensions: {
      ...(defaults.dimensions ?? {}),
      width: defaults.dimensions?.width ?? 800,
      height: defaults.dimensions?.height ?? 600,
      depth: defaults.dimensions?.depth ?? 300,
      ...(overrides.dimensions ?? {}),
    },
    options: {
      ...(defaults.options ?? {}),
      ...(overrides.options ?? {}),
    },
    metadata: { schemaVersion: 1 },
  };
}

function validationIsValid(result) {
  const status = result?.status ?? result?.validation?.status;
  if (typeof result?.valid === 'boolean') return result.valid;
  if (typeof result?.isValid === 'boolean') return result.isValid;
  return status === 'valid';
}

function validationMessages(result) {
  return result?.messages ?? result?.errors ?? result?.validation?.messages ?? [];
}

async function loadValidationApi() {
  const candidates = ['src/rules/validateProject.js', 'src/track-a/rules.js'];
  let mod;
  for (const candidate of candidates) {
    if (existsSync(path.join(repoRoot, candidate))) {
      mod = await importModule(candidate, 'shared validation rule engine');
      break;
    }
  }
  assert.ok(mod, `shared validation rule engine missing; tried ${candidates.join(', ')}`);
  const validateProject = mod.validateProject ?? mod.default;
  assert.equal(typeof validateProject, 'function', 'validation module must export validateProject or default function');
  return { validateProject, createProject: mod.createProject, updateProject: mod.updateProject };
}

async function runValidation(validateProject, project, template) {
  const attempts = [
    () => validateProject(project, template),
    () => validateProject({ project, template }),
    () => validateProject(template, project),
  ];
  let lastError;
  for (const attempt of attempts) {
    try {
      const result = await attempt();
      if (result && typeof result === 'object') return result;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('validateProject did not return an object for supported signatures');
}

async function loadDrawingApi() {
  const candidates = ['src/render/buildDrawingModel.js', 'src/track-a/drawing.js'];
  let mod;
  for (const candidate of candidates) {
    if (existsSync(path.join(repoRoot, candidate))) {
      mod = await importModule(candidate, 'canonical drawing model builder');
      break;
    }
  }
  assert.ok(mod, `canonical drawing model builder missing; tried ${candidates.join(', ')}`);
  const buildDrawingModel = mod.buildDrawingModel ?? mod.deriveDrawingModel ?? mod.default;
  assert.equal(typeof buildDrawingModel, 'function', 'drawing module must export buildDrawingModel, deriveDrawingModel, or default function');
  return buildDrawingModel;
}

async function buildDrawing(buildDrawingModel, project, template) {
  const attempts = [
    () => buildDrawingModel(project, template),
    () => buildDrawingModel({ project, template }),
    () => buildDrawingModel(template, project),
  ];
  let lastError;
  for (const attempt of attempts) {
    try {
      const result = await attempt();
      if (result && typeof result === 'object') return result;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('drawing model builder did not return an object for supported signatures');
}

function canonicalJson(value) {
  return JSON.stringify(value, Object.keys(value).sort());
}

test('template manifest exposes all five consultation families with needs_review draft constraints', async () => {
  const templates = await loadConsultationTemplates();
  const families = new Set(templates.map(templateFamily));
  for (const family of EXPECTED_FAMILIES) assert.ok(families.has(family), `missing selectable family ${family}`);

  for (const family of EXPECTED_FAMILIES) {
    const template = pickTemplate(templates, family);
    assert.equal(templateReviewStatus(template), 'needs_review', `${family} draft template must be needs_review`);
    assertDraftConstraintShape(template, family);
  }
});

test('CAD evidence/template data covers all 18 sample products without filename-only DWG-derived claims', () => {
  const templateFiles = [
    ...optionalJsonFiles('src/data/templates'),
    ...optionalJsonFiles('data/draft-templates'),
  ];
  assert.ok(templateFiles.length >= 18, `expected at least 18 template JSON files, found ${templateFiles.length}`);

  const evidenceFiles = [
    ...optionalJsonFiles('data/cad-evidence').filter((file) => !file.endsWith('/manifest.json')),
    ...optionalJsonFiles('data/cad-manifests').filter((file) => !file.endsWith('/index.json')),
  ];
  assert.ok(evidenceFiles.length >= 18, `expected at least 18 CAD evidence manifest JSON files, found ${evidenceFiles.length}`);

  for (const relativePath of evidenceFiles) {
    const manifest = readJson(relativePath, relativePath);
    assert.ok(manifest.sampleId ?? manifest.sample_id ?? manifest.templateId ?? manifest.template_id ?? manifest.inspection?.baseName, `${relativePath} must identify sample/template`);
    assert.ok(manifest.sourceFiles?.dwg ?? manifest.source?.dwg ?? manifest.files?.dwg?.path ?? manifest.assets?.dwg ?? manifest.inspection?.filePath, `${relativePath} must link source DWG`);
    const dwg = manifest.sourceEvidence?.dwg ?? manifest.dwg ?? manifest.extraction ?? manifest.files?.dwg ?? {};
    assert.ok(dwg.fileHashSha256 ?? dwg.sha256?.value ?? manifest.fileHashSha256 ?? manifest.inspection?.sha256, `${relativePath} must include direct DWG hash evidence`);
    assert.ok(dwg.dwgVersionSignature ?? dwg.signature?.value ?? manifest.dwgVersionSignature ?? manifest.inspection?.header?.signature, `${relativePath} must include direct DWG version signature evidence`);
    const status = dwg.dwgExtractionStatus ?? manifest.dwgExtractionStatus ?? manifest.status ?? manifest.dwg_inspection?.geometry_extraction_status ?? (manifest.toolProbe?.semanticExtractionAvailable === false ? 'blocked_by_tooling' : undefined);
    assert.ok(status, `${relativePath} must record DWG extraction status or blocker`);
    const evidenceKinds = JSON.stringify(manifest);
    assert.ok(!/DWG-derived/i.test(evidenceKinds) || /forbidden_label|dwg_entity|parsed_entities|direct_dwg|direct/i.test(evidenceKinds), `${relativePath} must not label values DWG-derived without direct DWG evidence`);
  }
});

test('DWG line geometry identifies leg-support templates without filename-only claims', () => {
  const templates = loadMvpTemplates();
  const withLegGeometry = templates.filter((template) =>
    template.drawingInfo?.productSelectionSignals?.some((signal) => signal.kind === 'leg_support_geometry'));
  const names = withLegGeometry.map((template) => template.displayName).sort();

  assert.deepEqual(names, ['하부장_2000', '하부장_8008 다리', '하부장_8100', '하부장_W1200_4도어 다리'].sort());
  for (const template of withLegGeometry) {
    assert.equal(template.defaults?.options?.mountType, 'legged', `${template.displayName} should default to legged from DWG support geometry`);
    const provenance = template.sourceEvidence?.inferredDefaults?.find((item) => item.field === 'options.mountType');
    assert.equal(provenance?.sourceKind, 'dwg_entity', `${template.displayName} leg-support provenance must be DWG entity geometry`);
    assert.equal(provenance?.reviewStatus, 'needs_review', `${template.displayName} leg-support semantic assignment must remain needs_review`);
    assert.ok(provenance?.evidence?.legLikePairCount >= 6, `${template.displayName} must expose repeated support-pair evidence`);
  }

  const wallMountedSampleNames = templates
    .filter((template) => /벽걸이/.test(template.displayName))
    .map((template) => template.displayName);
  for (const name of wallMountedSampleNames) {
    const template = templates.find((item) => item.displayName === name);
    assert.equal(
      template.drawingInfo?.productSelectionSignals?.some((signal) => signal.kind === 'leg_support_geometry'),
      false,
      `${name} must not be marked legged by filename when DWG support geometry is absent`,
    );
  }
});

test('shared validation blocks invalid dimensions and impossible option combinations', async () => {
  const templates = await loadConsultationTemplates();
  const { validateProject, createProject, updateProject } = await loadValidationApi();

  for (const template of templates) {
    const project = typeof createProject === 'function' ? createProject(template.id ?? template.templateId) : makeProject(template);
    const validResult = typeof createProject === 'function' ? validateProject(project, template) : await runValidation(validateProject, project, template);
    assert.equal(validationIsValid(validResult), true, `${template.family ?? template.displayName} default project must validate: ${JSON.stringify(validResult)}`);

    const widthRule = template.dimensions?.width ?? template.constraints?.dimensions?.width;
    assert.ok(widthRule, `${template.family ?? template.displayName} needs a width constraint`);
    const invalidWidthValue = (widthRule.max ?? 1000) + (widthRule.step ?? 1);
    const invalidWidth = typeof updateProject === 'function'
      ? updateProject(project, { dimensions: { width: invalidWidthValue } })
      : makeProject(template, { dimensions: { width: invalidWidthValue } });
    const invalidWidthResult = typeof createProject === 'function' ? validateProject(invalidWidth, template) : await runValidation(validateProject, invalidWidth, template);
    assert.equal(validationIsValid(invalidWidthResult), false, `out-of-range width must be invalid for ${template.family ?? template.displayName}`);
  }

  const slidingTemplate = pickTemplate(templates, '슬라이징장');
  const slidingProject = typeof createProject === 'function' ? createProject(slidingTemplate.id ?? slidingTemplate.templateId) : makeProject(slidingTemplate);
  const impossibleSliding = typeof updateProject === 'function'
    ? updateProject(slidingProject, { options: { sliding: false } })
    : { ...slidingProject, options: { ...slidingProject.options, sliding: false } };
  const impossibleSlidingResult = typeof createProject === 'function' ? validateProject(impossibleSliding, slidingTemplate) : await runValidation(validateProject, impossibleSliding, slidingTemplate);
  assert.equal(validationIsValid(impossibleSlidingResult), false, 'sliding cabinet with sliding=false must be invalid or unavailable');

  const threeDoorTemplate = pickTemplate(templates, '3도어장');
  const threeDoorProject = typeof createProject === 'function' ? createProject(threeDoorTemplate.id ?? threeDoorTemplate.templateId) : makeProject(threeDoorTemplate);
  const wrongDoorCount = typeof updateProject === 'function'
    ? updateProject(threeDoorProject, { options: { doorCount: 2 } })
    : { ...threeDoorProject, options: { ...threeDoorProject.options, doorCount: 2 } };
  const wrongDoorCountResult = typeof createProject === 'function' ? validateProject(wrongDoorCount, threeDoorTemplate) : await runValidation(validateProject, wrongDoorCount, threeDoorTemplate);
  assert.equal(validationIsValid(wrongDoorCountResult), false, '3도어장 must block non-3 door count');
});

test('drawing model and dimension table are deterministic across project JSON roundtrip', async () => {
  const templates = await loadConsultationTemplates();
  const template = pickTemplate(templates, '상부장');
  const { createProject, updateProject } = await loadValidationApi();
  const initial = typeof createProject === 'function' ? createProject(template.id ?? template.templateId) : makeProject(template);
  const project = typeof updateProject === 'function' ? updateProject(initial, { dimensions: { width: 900 } }) : makeProject(template, { dimensions: { width: 900 } });
  const buildDrawingModel = await loadDrawingApi();

  const first = await buildDrawing(buildDrawingModel, project, template);
  const roundTrippedProject = JSON.parse(JSON.stringify(project));
  const second = await buildDrawing(buildDrawingModel, roundTrippedProject, template);
  assert.deepEqual(second, first, 'same project/template must derive identical drawing model after JSON roundtrip');
});

test('drawing model renders hinge-aware dashed door opening direction marks', async () => {
  const templates = await loadConsultationTemplates();
  const { createProject, updateProject } = await loadValidationApi();
  const buildDrawingModel = await loadDrawingApi();
  const { renderSvg } = await importModule('src/render/renderSvg.js', 'SVG renderer');

  const upperTemplate = pickTemplate(templates, '상부장');
  const upperInitial = typeof createProject === 'function' ? createProject(upperTemplate.id ?? upperTemplate.templateId) : makeProject(upperTemplate);
  const upperProject = typeof updateProject === 'function'
    ? updateProject(upperInitial, { options: { doorCount: 2 } })
    : makeProject(upperTemplate, { options: { doorCount: 2 } });
  const upperModel = await buildDrawing(buildDrawingModel, upperProject, upperTemplate);
  assert.ok(upperModel.doorOpeningLines?.some((line) => line.lineStyle === 'dashed'), 'hinged doors must include dashed opening direction lines');
  assert.deepEqual(
    upperModel.hingeMarkers.filter((marker) => marker.id.endsWith('hinge-1')).map((marker) => marker.side),
    ['left', 'right'],
    'two-door samples use outer-side hinges with mirrored opening direction marks',
  );
  assert.match(renderSvg(upperModel), /door-opening-line dashed/, 'SVG must render dashed door opening direction marks');

  const baseTemplate = pickTemplate(templates, '하부장');
  const baseInitial = typeof createProject === 'function' ? createProject(baseTemplate.id ?? baseTemplate.templateId) : makeProject(baseTemplate);
  const fourDoorProject = typeof updateProject === 'function'
    ? updateProject(baseInitial, { options: { doorCount: 4 } })
    : makeProject(baseTemplate, { options: { doorCount: 4 } });
  const fourDoorModel = await buildDrawing(buildDrawingModel, fourDoorProject, baseTemplate);
  assert.deepEqual(
    fourDoorModel.hingeMarkers.filter((marker) => marker.id.endsWith('hinge-1')).map((marker) => marker.side),
    ['left', 'right', 'left', 'right'],
    'four-door samples repeat left/right hinge pairs',
  );

  const slidingTemplate = pickTemplate(templates, '슬라이징장');
  const slidingProject = typeof createProject === 'function' ? createProject(slidingTemplate.id ?? slidingTemplate.templateId) : makeProject(slidingTemplate);
  const slidingModel = await buildDrawing(buildDrawingModel, slidingProject, slidingTemplate);
  assert.equal(slidingModel.doorOpeningLines.length, 0, 'sliding cabinets must not show hinged door opening direction marks');
});

test('export modules expose validity preconditions instead of exporting invalid projects', async () => {
  const candidateGroups = [
    ['src/export/exportProjectJson.js', 'src/track-a/exports.js'],
    ['src/export/exportPdf.js', 'src/track-a/exports.js'],
    ['src/export/exportCapture.js', 'src/track-a/exports.js'],
  ];
  for (const candidates of candidateGroups) {
    const relativePath = candidates.find((candidate) => existsSync(path.join(repoRoot, candidate)));
    assert.ok(relativePath, `export module missing; tried ${candidates.join(', ')}`);
    const mod = await importModule(relativePath, `${relativePath} export module`);
    const exportedFns = Object.values(mod).filter((value) => typeof value === 'function');
    assert.ok(exportedFns.length > 0, `${relativePath} must export at least one function`);
    const source = readFileSync(path.join(repoRoot, relativePath), 'utf8');
    assert.match(source, /valid|validation|canExport|precondition|invalid|Cannot export/i, `${relativePath} must visibly check export validity/preconditions`);
  }
});
