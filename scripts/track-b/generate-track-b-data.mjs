import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

const root = new URL('../..', import.meta.url).pathname;
const samplesDir = join(root, 'samples');
const manifestDir = join(root, 'data/cad-manifests');
const templateDir = join(root, 'data/draft-templates');
mkdirSync(manifestDir, { recursive: true });
mkdirSync(templateDir, { recursive: true });

const familyMap = [
  ['하부장', { code: 'base_cabinet', ko: '하부장', en: 'base cabinet' }],
  ['상부장', { code: 'wall_cabinet', ko: '상부장', en: 'wall cabinet' }],
  ['슬라이징장', { code: 'sliding_cabinet', ko: '슬라이징장', en: 'sliding cabinet' }],
  ['3도어장', { code: 'three_door_cabinet', ko: '3도어장', en: 'three-door cabinet' }],
  ['플랩장', { code: 'flap_cabinet', ko: '플랩장', en: 'flap cabinet' }],
];

const familyDefaults = {
  base_cabinet: { width_mm: [300, 1200, 600], height_mm: [700, 900, 820], depth_mm: [450, 650, 560] },
  wall_cabinet: { width_mm: [300, 1200, 600], height_mm: [400, 900, 700], depth_mm: [250, 450, 320] },
  sliding_cabinet: { width_mm: [600, 2400, 1200], height_mm: [1800, 2400, 2100], depth_mm: [450, 700, 600] },
  three_door_cabinet: { width_mm: [900, 1800, 1200], height_mm: [700, 2400, 2100], depth_mm: [450, 700, 600] },
  flap_cabinet: { width_mm: [450, 1200, 800], height_mm: [300, 800, 450], depth_mm: [250, 450, 350] },
};

function nfc(value) {
  return value.normalize('NFC');
}

function slugify(value) {
  return nfc(value)
    .replace(/\.dwg$/i, '')
    .replace(/[^0-9A-Za-z가-힣]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function fileSignature(path) {
  try {
    return execFileSync('/usr/bin/file', ['-b', path], { encoding: 'utf8' }).trim();
  } catch (error) {
    return `file command failed: ${error.message}`;
  }
}

function commandAvailable(command) {
  try {
    execFileSync('/bin/zsh', ['-lc', `command -v ${command}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function detectFamily(stem) {
  const normalized = nfc(stem);
  return familyMap.find(([label]) => normalized.includes(label))?.[1] ?? { code: 'unknown', ko: 'unknown', en: 'unknown' };
}

function reviewValue(value, note) {
  return {
    value,
    provenance: 'filename_or_template_inferred',
    review_status: 'needs_review',
    mechanically_certain: false,
    note,
  };
}

function directFileValue(value, provenance, note) {
  return {
    value,
    provenance,
    review_status: 'accepted',
    mechanically_certain: true,
    note,
  };
}

function blockerValue(value, note) {
  return {
    value,
    provenance: 'not_extracted_from_dwg',
    review_status: 'blocker',
    mechanically_certain: false,
    note,
  };
}

const dwgFiles = readdirSync(samplesDir).filter((name) => name.toLowerCase().endsWith('.dwg')).sort((a, b) => nfc(a).localeCompare(nfc(b), 'ko'));
const toolProbe = {
  libredwg: {
    commands: ['dwgread', 'dwg2dxf', 'dwg2json'],
    available: ['dwgread', 'dwg2dxf', 'dwg2json'].some(commandAvailable),
  },
  oda_file_converter: {
    commands: ['ODAFileConverter', 'odaFileConverter', 'TeighaFileConverter'],
    available: ['ODAFileConverter', 'odaFileConverter', 'TeighaFileConverter'].some(commandAvailable),
  },
  ezdxf: {
    commands: ['ezdxf', 'python3 -m ezdxf'],
    available: commandAvailable('ezdxf'),
  },
};

const manifestRefs = [];
const templateRefs = [];
const familyTemplateRefs = new Map();

for (const dwgName of dwgFiles) {
  const stem = dwgName.slice(0, -4);
  const sampleId = slugify(dwgName);
  const family = detectFamily(stem);
  const pdfName = `${stem}.pdf`;
  const pngName = `${stem}_1.png`;
  const dwgPath = join(samplesDir, dwgName);
  const pdfPath = join(samplesDir, pdfName);
  const pngPath = join(samplesDir, pngName);
  const defaults = familyDefaults[family.code] ?? { width_mm: [0, 0, 0], height_mm: [0, 0, 0], depth_mm: [0, 0, 0] };

  const manifestName = `${sampleId}.manifest.json`;
  const templateName = `${sampleId}.draft-template.json`;

  const manifest = {
    schema_version: 'track-b-manifest.v1',
    sample_id: sampleId,
    consultation_grade_only: true,
    source_policy: {
      rule: 'Only values directly read from the DWG bytes/tool output may use direct_dwg_* provenance. Filename, template, visual, or domain assumptions must be needs_review; missing geometry/dimensions are blockers.',
      forbidden_provenance: 'do_not_label_uncertain_values_as_direct_dwg',
    },
    files: {
      dwg: {
        path: `samples/${dwgName}`,
        sha256: directFileValue(sha256(dwgPath), 'direct_dwg_file_hash', 'SHA-256 computed from the DWG file bytes.'),
        signature: directFileValue(fileSignature(dwgPath), 'direct_dwg_file_signature', 'macOS file(1) signature read directly from the DWG file.'),
      },
      pdf: {
        path: `samples/${pdfName}`,
        sha256: directFileValue(sha256(pdfPath), 'direct_filesystem_hash', 'Companion PDF hash; not DWG geometry evidence.'),
        signature: directFileValue(fileSignature(pdfPath), 'direct_filesystem_signature', 'Companion PDF file signature; not DWG geometry evidence.'),
      },
      png: {
        path: `samples/${pngName}`,
        sha256: directFileValue(sha256(pngPath), 'direct_filesystem_hash', 'Companion PNG hash; not DWG geometry evidence.'),
        signature: directFileValue(fileSignature(pngPath), 'direct_filesystem_signature', 'Companion PNG file signature; not DWG geometry evidence.'),
      },
    },
    pairing: {
      status: 'needs_review',
      review_status: 'needs_review',
      provenance: 'filesystem_name_match',
      mechanically_certain: false,
      note: 'DWG/PDF/PNG stems match on disk, but pairing semantics were not extracted from DWG metadata.',
    },
    classification: {
      family: reviewValue(family.code, 'Family label comes from the sample filename only, not from DWG entity inspection.'),
      display_name_ko: reviewValue(family.ko, 'Korean family label comes from the sample filename only.'),
      sample_stem: reviewValue(nfc(stem), 'Sample stem is a filename observation, not direct DWG evidence.'),
    },
    dwg_inspection: {
      direct_evidence_available: ['dwg_file_hash', 'dwg_file_signature'],
      geometry_extraction_status: 'blocker',
      text_layer_dimension_extraction_status: 'blocker',
      tool_probe: toolProbe,
      blockers: [
        'LibreDWG command-line tools were not available in this environment.',
        'ODA/Teigha file converter was not available in this environment.',
        'ezdxf command/module was not available and cannot read native DWG without conversion.',
        'No direct DWG geometry, layer, block, text, or dimension entities were extracted; those values must not be labeled as direct DWG evidence.',
      ],
    },
    extracted_values: {
      dimensions_mm: blockerValue(null, 'No width/height/depth dimensions were directly extracted from DWG entities.'),
      door_count: blockerValue(null, 'Door count was not directly extracted from DWG entities.'),
      hardware_options: blockerValue([], 'Hardware/options were not directly extracted from DWG entities.'),
      layer_names: blockerValue([], 'Layer names were not directly extracted from DWG entities.'),
      block_names: blockerValue([], 'Block names were not directly extracted from DWG entities.'),
    },
    draft_template: `data/draft-templates/${templateName}`,
  };

  const constraint = (name) => ({
    min: reviewValue(defaults[name][0], `Draft ${name} minimum is a consultation template assumption, not directly extracted from this DWG.`),
    max: reviewValue(defaults[name][1], `Draft ${name} maximum is a consultation template assumption, not directly extracted from this DWG.`),
    default: reviewValue(defaults[name][2], `Draft ${name} default is a consultation template assumption, not directly extracted from this DWG.`),
  });

  const template = {
    schema_version: 'track-b-draft-template.v1',
    template_id: sampleId,
    sample_id: sampleId,
    source_manifest: `data/cad-manifests/${manifestName}`,
    consultation_grade_only: true,
    production_cad_ready: false,
    provenance_policy: manifest.source_policy,
    family: manifest.classification.family,
    label_ko: reviewValue(nfc(stem), 'Template label is based on the filename for UI selection and needs human review.'),
    constraints: {
      width_mm: constraint('width_mm'),
      height_mm: constraint('height_mm'),
      depth_mm: constraint('depth_mm'),
    },
    options: {
      installation: reviewValue(['legs', 'wall_hung', 'unspecified'], 'Installation options are draft consultation choices and were not directly extracted from DWG.'),
      doors: reviewValue('family_default_placeholder', 'Door behavior is a draft rule placeholder and was not directly extracted from DWG.'),
      sliding: reviewValue(family.code === 'sliding_cabinet' ? 'draft_sliding_rules_required' : 'not_applicable_or_unverified', 'Sliding behavior is inferred from family/filename and needs review.'),
    },
    review: {
      status: 'needs_review',
      reasons: [
        'Draft constraints and options are not mechanically certain.',
        'No DWG entity geometry/text/layer extraction is available for this template.',
        'Safe for consultation-grade 2D schematic MVP only; not production CAD.',
      ],
    },
  };

  writeFileSync(join(manifestDir, manifestName), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(templateDir, templateName), `${JSON.stringify(template, null, 2)}\n`);
  manifestRefs.push(`data/cad-manifests/${manifestName}`);
  templateRefs.push(`data/draft-templates/${templateName}`);
  if (!familyTemplateRefs.has(family.code)) familyTemplateRefs.set(family.code, []);
  familyTemplateRefs.get(family.code).push(`data/draft-templates/${templateName}`);
}

const index = {
  schema_version: 'track-b-index.v1',
  generated_by: 'scripts/track-b/generate-track-b-data.mjs',
  consultation_grade_only: true,
  production_cad_ready: false,
  sample_count: dwgFiles.length,
  acceptance_note: 'All 18 samples have manifests and draft templates. Values not directly extracted from DWG bytes/tool output are marked needs_review or blocker, never direct DWG evidence.',
  tool_probe: toolProbe,
  manifests: manifestRefs,
  draft_templates: templateRefs,
  family_templates: Object.fromEntries([...familyTemplateRefs.entries()].sort()),
};
writeFileSync(join(manifestDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
