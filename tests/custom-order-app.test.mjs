import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [html, css, js] = await Promise.all([
  readFile('index.html', 'utf8'),
  readFile('src/styles.css', 'utf8'),
  readFile('src/main.js', 'utf8'),
]);

test('app shell uses the DOCTYPE custom-order implementation entrypoints', () => {
  assert.match(html, /욕실가구 비규격 발주서/);
  assert.match(html, /id="home-screen"/);
  assert.match(html, /id="template-screen"/);
  assert.match(html, /id="dashboard-screen"/);
  assert.match(html, /id="editor-screen"/);
  assert.match(html, /id="hinge-panel"/);
  assert.match(html, /id="hinge-door"/);
  assert.match(html, /id="color-exterior"/);
  assert.match(html, /id="color-interior"/);
  assert.match(html, /id="role-select"/);
  assert.match(html, /id="asset-list"/);
  assert.match(html, /id="comment-input"/);
  assert.match(html, /id="ops-notification-list"/);
  assert.match(html, /id="ops-queue"/);
  assert.match(html, /id="ops-thread"/);
  assert.match(html, /id="ops-comment-send"/);
  assert.match(html, /id="btn-approve"/);
  assert.match(html, /id="constraint-status"/);
  assert.match(html, /src\/styles\.css/);
  assert.match(html, /src\/main\.js/);
});

test('stylesheet contains the imported responsive drawing UI system and DWG template metadata UI', () => {
  for (const selector of ['.choice-card', '.template-card', '.template-meta', '.template-evidence', '.canvas-host', '.dim-line', '.door-hinge-panel', '.hinge-position-mark', '.color-control', '.cabinet-interior-surface', '.modal-backdrop', '.workflow-strip', '.status-chip', '.asset-row', '.comment-item', '.constraint-status', '.ops-summary', '.ops-notification', '.ops-queue-row', '.thread-bubble']) {
    assert.ok(css.includes(selector), `${selector} style is missing`);
  }
  assert.match(css, /@media \(max-width: 768px\)/);
});

test('main script loads DWG sample templates and preserves interactive order actions', () => {
  for (const token of [
    "import templateManifest from './data/templateManifest.json'",
    "from './workflow.js'",
    'function loadDwgSampleTemplates()',
    'function normalizeDwgTemplate(entry, template)',
    'function buildTemplateInternals(family, options)',
    'function buildLegSupports()',
    'function shouldRenderLegSupports(tpl)',
    'function hingedDoorCount()',
    'function buildDoorHingeOverlay()',
    'function buildCabinetSurfaces()',
    'function updateFinishColor(kind, value)',
    'async function saveCurrentAsset({ share = false } = {})',
    'function renderDashboard()',
    'function renderDashboardNotifications(model)',
    'function renderDashboardQueue(model)',
    'function renderThreadMessages(messages, emptyText)',
    'function serializeDrawingState()',
    'function restoreDrawingSnapshot(snapshot)',
    'function validateDrawingState(candidate = {})',
    'function placementErrors(item, others = state.items, bounds = cabinetBounds(), led = state.led)',
    'function commitItemCandidate(id, patch)',
    'function commitDimensionCandidate(patch)',
    "requestJson('/api/assets'",
    'localStorage',
    'cabione:drawing-assets:v1',
    '관리자 공유',
    'data-dashboard-filter',
    'btn-approve',
    'function legCenterRatios(tpl)',
    'data-door-hinge',
    'data-exterior-color',
    'Finish Colors',
    'Door Hinges',
    'dwgExtractionStatus',
    'leg_support_geometry',
    'draft legged mount',
    'data-leg-source',
    'entityCount',
    'dimensionCount',
    'shelf:',
    'guidebar:',
    'outlet1:',
    'outlet2:',
    'function render()',
    'function buildOuterDims()',
    'function buildItemDims(item)',
    'function copyText(text)',
  ]) {
    assert.ok(js.includes(token), `${token} is missing`);
  }
  assert.equal(js.includes("code: 'BMC-A1'"), false, 'legacy hard-coded example catalog should not drive the live selector');
});

test('DWG template manifest uses Vercel-stable NFC asset paths', async () => {
  const manifest = JSON.parse(await readFile('src/data/templateManifest.json', 'utf8'));
  for (const entry of manifest.templates ?? []) {
    assert.equal(entry.path, entry.path.normalize('NFC'), `${entry.templateId} path must be NFC-normalized`);
    await readFile(entry.path, 'utf8');
  }
});
