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
  assert.match(html, /id="editor-screen"/);
  assert.match(html, /src\/styles\.css/);
  assert.match(html, /src\/main\.js/);
});

test('stylesheet contains the imported responsive drawing UI system', () => {
  for (const selector of ['.choice-card', '.template-card', '.canvas-host', '.dim-line', '.modal-backdrop']) {
    assert.ok(css.includes(selector), `${selector} style is missing`);
  }
  assert.match(css, /@media \(max-width: 768px\)/);
});

test('main script exposes templates, interactive options, dimensions, and order actions', () => {
  for (const token of [
    'const TEMPLATES = [',
    "code: 'BMC-A1'",
    "code: 'BMC-F1'",
    "shelf:",
    "guidebar:",
    "outlet1:",
    "outlet2:",
    'function render()',
    'function buildOuterDims()',
    'function buildItemDims(item)',
    'function copyText(text)',
  ]) {
    assert.ok(js.includes(token), `${token} is missing`);
  }
});
