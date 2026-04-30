import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const samplesDir = join(root, 'samples');
const evidenceDir = join(root, 'data/cad-evidence');
const templateDir = join(root, 'src/data/templates');
mkdirSync(evidenceDir, { recursive: true });
mkdirSync(templateDir, { recursive: true });

const familyDefs = [
  ['하부장', 'base_cabinet', '하부장'],
  ['상부장', 'wall_cabinet', '상부장'],
  ['슬라이징장', 'sliding_cabinet', '슬라이징장'],
  ['3도어장', 'three_door_cabinet', '3도어장'],
  ['플랩장', 'flap_cabinet', '플랩장'],
];

const rules = {
  base_cabinet: { dims: { width: [400, 1500, 800], height: [350, 900, 720], depth: [350, 600, 560] }, options: { doorCount: 2, mountType: 'legged', flapCount: 0, sliding: false, slidingPanelCount: 0 } },
  wall_cabinet: { dims: { width: [300, 1200, 800], height: [300, 900, 600], depth: [120, 250, 170] }, options: { doorCount: 2, mountType: 'wall_mounted', flapCount: 0, sliding: false, slidingPanelCount: 0 } },
  sliding_cabinet: { dims: { width: [600, 1800, 1200], height: [400, 1200, 900], depth: [120, 350, 250] }, options: { doorCount: 0, mountType: 'wall_mounted', flapCount: 0, sliding: true, slidingPanelCount: 2 } },
  three_door_cabinet: { dims: { width: [900, 1800, 1200], height: [350, 900, 720], depth: [350, 650, 560] }, options: { doorCount: 3, mountType: 'legged', flapCount: 0, sliding: false, slidingPanelCount: 0 } },
  flap_cabinet: { dims: { width: [450, 1200, 800], height: [300, 800, 450], depth: [250, 450, 350] }, options: { doorCount: 0, mountType: 'wall_mounted', flapCount: 1, sliding: false, slidingPanelCount: 0 } },
};

function nfc(value) { return value.normalize('NFC'); }
function slugify(value) {
  return nfc(value).replace(/\.dwg$/i, '').replace(/[^0-9A-Za-z가-힣]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}
function sha256(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function fileSignature(path) {
  try { return execFileSync('/usr/bin/file', ['-b', path], { encoding: 'utf8' }).trim(); }
  catch (error) { return `file command failed: ${error.message}`; }
}
function commandAvailable(command) {
  try { execFileSync('/bin/zsh', ['-lc', `command -v ${command}`], { stdio: 'ignore' }); return true; }
  catch { return false; }
}
function detectFamily(stem) {
  const normalized = nfc(stem);
  const found = familyDefs.find(([label]) => normalized.includes(label));
  if (!found) return { familyId: 'unknown', familyDisplayName: 'unknown' };
  return { familyId: found[1], familyDisplayName: found[2] };
}
function review(value, sourceKind, note) {
  return { value, sourceKind, reviewStatus: 'needs_review', mechanicallyCertain: false, note };
}
function direct(value, sourceKind, note) {
  return { value, sourceKind, reviewStatus: 'accepted', mechanicallyCertain: true, note };
}
function dimRule([min, max, def]) {
  return {
    min,
    max,
    step: 10,
    default: def,
    reviewStatus: 'needs_review',
    sourceKind: 'common_logic',
    mechanicallyCertain: false,
    note: 'Draft consultation constraint; not directly extracted from DWG entities.',
  };
}
const toolProbe = {
  libredwg: { commands: ['dwgread', 'dwg2dxf', 'dwglayers', 'dwggrep'], available: ['dwgread', 'dwg2dxf', 'dwglayers', 'dwggrep'].some(commandAvailable) },
  odaFileConverter: { commands: ['ODAFileConverter', 'odaFileConverter', 'TeighaFileConverter'], available: ['ODAFileConverter', 'odaFileConverter', 'TeighaFileConverter'].some(commandAvailable) },
  ezdxf: { commands: ['ezdxf', 'python3 -m ezdxf'], available: commandAvailable('ezdxf') },
};

const templates = [];
const evidenceFiles = [];
const dwgFiles = readdirSync(samplesDir).filter((name) => name.toLowerCase().endsWith('.dwg')).sort((a, b) => nfc(a).localeCompare(nfc(b), 'ko'));

for (const dwgName of dwgFiles) {
  const stem = dwgName.slice(0, -4);
  const sampleId = slugify(dwgName);
  const { familyId, familyDisplayName } = detectFamily(stem);
  const rule = rules[familyId];
  const pdfName = `${stem}.pdf`;
  const pngName = `${stem}_1.png`;
  const dwgPath = join(samplesDir, dwgName);
  const pdfPath = join(samplesDir, pdfName);
  const pngPath = join(samplesDir, pngName);
  const header = readFileSync(dwgPath).subarray(0, 6).toString('ascii');
  const extractionAvailable = toolProbe.libredwg.available || toolProbe.odaFileConverter.available;
  const dwgExtractionStatus = extractionAvailable ? 'conversion_not_run' : 'blocked_by_tooling';
  const evidenceName = `${sampleId}.manifest.json`;
  const templateName = `${sampleId}.json`;
  const sourceFiles = {
    dwg: `samples/${dwgName}`,
    pdf: existsSync(pdfPath) ? `samples/${pdfName}` : null,
    png: existsSync(pngPath) ? `samples/${pngName}` : null,
  };
  const evidence = {
    schemaVersion: 1,
    sampleId,
    templateId: sampleId,
    familyId,
    familyDisplayName,
    consultationGradeOnly: true,
    productionCadReady: false,
    sourceFiles,
    sourceEvidence: {
      dwg: {
        sourceKind: 'direct_dwg_file_bytes',
        fileHashSha256: sha256(dwgPath),
        dwgVersionSignature: header,
        fileSignature: fileSignature(dwgPath),
        dwgExtractionStatus,
        toolProbe,
        extractedEntityCounts: { layers: 0, text: 0, dimensions: 0, blocks: 0, lines: 0, polylines: 0, rectangleCandidates: 0 },
        blockers: extractionAvailable ? ['DWG converter appears available but entity extraction was not completed in this MVP pass.'] : ['LibreDWG commands not available on PATH.', 'ODA File Converter not available on PATH.', 'Native DWG entity extraction blocked by local tooling.'],
      },
      pdf: sourceFiles.pdf ? { sourceKind: 'filesystem_pairing', fileHashSha256: sha256(pdfPath), fileSignature: fileSignature(pdfPath), reviewStatus: 'needs_review' } : null,
      png: sourceFiles.png ? { sourceKind: 'filesystem_pairing', fileHashSha256: sha256(pngPath), fileSignature: fileSignature(pngPath), reviewStatus: 'needs_review' } : null,
    },
    extracted: {
      layers: { value: [], sourceKind: 'blocked_by_tooling', reviewStatus: 'blocker' },
      text: { value: [], sourceKind: 'blocked_by_tooling', reviewStatus: 'blocker' },
      dimensions: { value: null, sourceKind: 'blocked_by_tooling', reviewStatus: 'blocker' },
      blocks: { value: [], sourceKind: 'blocked_by_tooling', reviewStatus: 'blocker' },
      boundingBoxes: { value: null, sourceKind: 'blocked_by_tooling', reviewStatus: 'blocker' },
      frontViewCandidates: { value: [], sourceKind: 'blocked_by_tooling', reviewStatus: 'blocker' },
    },
    inferredFields: {
      family: review(familyId, 'filename_hint', 'Family comes from filename only; not DWG-derived.'),
      displayName: review(nfc(stem), 'filename_hint', 'Display name comes from filename only.'),
      constraints: review('draft_family_rules', 'common_logic', 'Draft constraints are common consultation logic and require review.'),
    },
  };
  writeFileSync(join(evidenceDir, evidenceName), `${JSON.stringify(evidence, null, 2)}\n`);
  evidenceFiles.push(`data/cad-evidence/${evidenceName}`);

  const template = {
    schemaVersion: 1,
    templateId: sampleId,
    sampleId,
    familyId,
    familyDisplayName,
    displayName: nfc(stem),
    reviewStatus: 'needs_review',
    consultationGradeOnly: true,
    productionCadReady: false,
    defaults: { dimensions: { width: rule.dims.width[2], height: rule.dims.height[2], depth: rule.dims.depth[2] }, options: rule.options },
    constraints: {
      reviewStatus: 'needs_review',
      sourceKind: 'common_logic',
      mechanicallyCertain: false,
      dimensions: { width: dimRule(rule.dims.width), height: dimRule(rule.dims.height), depth: dimRule(rule.dims.depth) },
      options: { reviewStatus: 'needs_review', sourceKind: 'common_logic', note: 'Option constraints are family draft rules and not DWG-derived.' },
    },
    sourceFiles,
    sourceEvidence: { manifest: `data/cad-evidence/${evidenceName}`, dwgExtractionStatus },
  };
  writeFileSync(join(templateDir, templateName), `${JSON.stringify(template, null, 2)}\n`);
  templates.push({ templateId: sampleId, familyId, familyDisplayName, displayName: nfc(stem), path: `src/data/templates/${templateName}`, reviewStatus: 'needs_review' });
}

const manifest = {
  schemaVersion: 1,
  generatedBy: 'scripts/generate-app-data.mjs',
  generatedAt: new Date().toISOString(),
  consultationGradeOnly: true,
  productionCadReady: false,
  sampleCount: dwgFiles.length,
  familyCount: new Set(templates.map((item) => item.familyId)).size,
  templates,
  cadEvidence: evidenceFiles,
  toolProbe,
  evidencePolicy: 'DWG hashes and AC signatures are direct byte evidence; all non-extracted dimensions/options/family values are needs_review or blocker and are not DWG-derived.',
};
writeFileSync(join(root, 'src/data/templateManifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
