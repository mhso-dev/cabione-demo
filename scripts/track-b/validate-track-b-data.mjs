import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../..', import.meta.url).pathname;
const manifestDir = join(root, 'data/cad-manifests');
const evidenceDir = join(root, 'data/cad-evidence');
const templateDir = join(root, 'data/draft-templates');
const errors = [];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function walk(value, visitor, path = '$') {
  visitor(value, path);
  if (Array.isArray(value)) value.forEach((item, index) => walk(item, visitor, `${path}[${index}]`));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) walk(child, visitor, `${path}.${key}`);
  }
}

const evidenceFiles = readdirSync(evidenceDir).filter((name) => name.endsWith('.json') && name !== 'manifest.json').sort();
const manifestFiles = readdirSync(manifestDir).filter((name) => name.endsWith('.manifest.json')).sort();
const draftTemplates = readdirSync(templateDir).filter((name) => name.endsWith('.json')).sort();
const generatedDraftTemplates = draftTemplates.filter((name) => !name.endsWith('.draft-template.json'));
const strictDraftTemplates = draftTemplates.filter((name) => name.endsWith('.draft-template.json'));

if (evidenceFiles.length !== 18) errors.push(`Expected 18 CAD evidence files, found ${evidenceFiles.length}`);
if (generatedDraftTemplates.length !== 18) errors.push(`Expected 18 generated draft template JSON files, found ${generatedDraftTemplates.length}`);
if (strictDraftTemplates.length !== 18) errors.push(`Expected 18 strict provenance draft-template JSON files, found ${strictDraftTemplates.length}`);
if (manifestFiles.length !== 18) errors.push(`Expected 18 strict manifest JSON files, found ${manifestFiles.length}`);

const allowedDirectDwgProvenance = new Set(['direct_dwg_file_hash', 'direct_dwg_file_signature']);
const allowedDwgSourceKind = new Set(['dwg_header', 'dwg_entity']);
const allowedUncertainStatus = new Set(['needs_review', 'blocker', 'blocked_by_tooling']);

for (const [kind, dir, files] of [
  ['cad-evidence', evidenceDir, evidenceFiles],
  ['strict-manifest', manifestDir, manifestFiles],
  ['draft-template', templateDir, draftTemplates],
]) {
  for (const file of files) {
    const json = readJson(join(dir, file));
    walk(json, (node, path) => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return;
      const provenance = typeof node.provenance === 'string' ? node.provenance : '';
      const sourceKind = typeof node.sourceKind === 'string' ? node.sourceKind : '';
      const reviewStatus = node.review_status ?? node.reviewStatus;
      const mechanicallyCertain = node.mechanically_certain ?? node.mechanicallyCertain;

      if (/dwg[-_ ]?derived/i.test(provenance) || /dwg[-_ ]?derived/i.test(sourceKind)) {
        errors.push(`${kind} ${file} ${path} uses forbidden DWG-derived provenance/sourceKind`);
      }
      if (provenance.startsWith('direct_dwg') && !allowedDirectDwgProvenance.has(provenance)) {
        errors.push(`${kind} ${file} ${path} uses unapproved direct DWG provenance: ${provenance}`);
      }
      if (sourceKind.startsWith('dwg_') && !allowedDwgSourceKind.has(sourceKind)) {
        errors.push(`${kind} ${file} ${path} uses unapproved direct DWG sourceKind: ${sourceKind}`);
      }
      if ((mechanicallyCertain === false || provenance.includes('inferred') || sourceKind === 'filename_hint') && !allowedUncertainStatus.has(reviewStatus)) {
        errors.push(`${kind} ${file} ${path} uncertain/inferred value must be needs_review or blocker, got ${reviewStatus}`);
      }
      if ((provenance === 'not_extracted_from_dwg' || sourceKind === 'blocked_by_tooling') && !['blocker', 'blocked_by_tooling'].includes(reviewStatus)) {
        errors.push(`${kind} ${file} ${path} missing DWG extraction must be blocker, got ${reviewStatus}`);
      }
    });
  }
}

const index = readJson(join(manifestDir, 'index.json'));
const sampleCount = index.sample_count ?? index.sampleCount;
if (sampleCount !== 18) errors.push(`index sample_count expected 18, found ${sampleCount}`);
if ((index.manifests ?? index.entries?.map((entry) => entry.evidencePath))?.length !== 18) errors.push('index must list 18 manifests/evidence entries');
if ((index.draft_templates ?? index.entries?.map((entry) => entry.templatePath))?.length !== 18) errors.push('index must list 18 draft templates');
for (const family of ['base_cabinet', 'wall_cabinet', 'sliding_cabinet', 'three_door_cabinet', 'flap_cabinet']) {
  if (!index.family_templates?.[family]?.length) errors.push(`index missing family templates for ${family}`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('PASS track-b data validation: 18 evidence files, 18 manifests, 36 draft templates, no false DWG-derived labels, uncertain inferred values needs_review/blocker.');
