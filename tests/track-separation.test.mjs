import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { trackADraftTemplates } from '../src/data/templates/track-a-draft-templates.js';
import { assertNoFalseDwgDerivedLabels } from '../src/shared/review-status.js';
import { assertTrackAIsIndependent } from '../src/shared/track-boundaries.js';
import { deriveDrawingModel } from '../src/track-a/drawing.js';
import { buildCapturePayload, buildPrintableHtml, exportProjectJson } from '../src/track-a/exports.js';
import { createProject, deserializeProject, updateProject, validateProject } from '../src/track-a/rules.js';

test('Track A is explicitly independent from DWG automation', async () => {
  assert.equal(assertTrackAIsIndependent(), true);
  for (const template of trackADraftTemplates) {
    assert.equal(template.track, 'A');
    assert.equal(template.dwgAutomationRequired, false);
    assert.equal(template.reviewStatus, 'needs_review');
  }
  const appSource = await readFile('src/track-a/app.js', 'utf8');
  assert.equal(appSource.includes('../track-b/'), false);
});

test('Track A covers five observed families with draft constraints', () => {
  assert.deepEqual(trackADraftTemplates.map((template) => template.family).sort(), ['3도어장', '상부장', '슬라이징장', '플랩장', '하부장'].sort());
  for (const template of trackADraftTemplates) {
    for (const rule of Object.values(template.dimensions)) {
      assert.equal(rule.reviewStatus, 'needs_review');
      assert.equal(rule.sourceKind, 'common_logic');
    }
  }
});

test('Track A validation blocks invalid dimensions and allows valid roundtrip/export', () => {
  for (const template of trackADraftTemplates) {
    const project = createProject(template.id);
    assert.equal(validateProject(project, template).valid, true, template.family);
    const invalid = updateProject(project, { dimensions: { width: template.dimensions.width.max + template.dimensions.width.step } });
    assert.equal(validateProject(invalid, template).valid, false, template.family);
    const drawing = deriveDrawingModel(project, template);
    assert.equal(drawing.family, template.family);
    assert.ok(buildPrintableHtml(project, template).includes('consultation-grade schematic'));
    assert.ok(buildCapturePayload(project, template).content.includes(template.family));
    assert.deepEqual(deserializeProject(exportProjectJson(project)), project);
  }
});

test('Track B generated manifest uses direct DWG inspection and does not claim filename-derived values as DWG-derived', async () => {
  const manifest = JSON.parse(await readFile('src/data/trackBTemplateManifest.json', 'utf8'));
  assert.equal(manifest.track, 'B');
  assert.equal(manifest.filenameOnlyInferenceForbidden, true);
  assert.equal(manifest.sampleCount, 18);
  assert.equal(manifest.entries.length, 18);
  for (const entry of manifest.entries) {
    assert.equal(entry.directInspection, true);
    const template = JSON.parse(await readFile(entry.templatePath, 'utf8'));
    assert.equal(template.track, 'B');
    assert.equal(template.filenameOnlyInferenceForbidden, true);
    assert.equal(template.dwgExtractionStatus, 'entity_extracted');
    assert.ok(template.drawingInfo?.entityCounts, 'Track B template must include direct DWG entity counts');
    assert.ok(template.drawingInfo?.dimensions?.extractedCount > 0, 'Track B template must include direct DWG dimension entities');
    assert.ok(template.dwgDerivedValues.length >= 2, 'Track B must record directly extracted DWG evidence values');
    assert.equal(template.values.familyHint.reviewStatus, 'needs_review');
    assert.equal(template.values.familyHint.sourceKind, 'filename_hint');
    assertNoFalseDwgDerivedLabels(template, entry.templatePath);
  }
});
