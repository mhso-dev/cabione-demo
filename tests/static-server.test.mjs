import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCabioneServer, isAllowedStaticPath, resolveStaticPath } from '../docker/static-server.mjs';

function sampleAsset(overrides = {}) {
  return {
    id: 'drawing-test-1',
    title: '테스트 도면',
    reviewStatus: 'draft',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    sharedAt: null,
    createdBy: 'sales',
    drawing: {
      schemaVersion: 1,
      mode: 'custom',
      templateCode: null,
      templateName: null,
      family: null,
      dimensions: { width: 600, height: 600, depth: 300 },
      items: [{ id: 'item-1', type: 'shelf', x: 40, y: 300, w: 520, h: 18 }],
      led: null,
      finishColors: {},
      hingeConfig: { selectedDoor: 1, doors: [] },
    },
    comments: [],
    ...overrides,
  };
}

async function withServer(run) {
  const dataDir = await mkdtemp(join(tmpdir(), 'cabione-assets-'));
  const server = createCabioneServer({ rootDir: process.cwd(), dataDir });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
}

test('static server serves only app assets and survives malformed URLs', async () => {
  assert.equal(isAllowedStaticPath('/'), true);
  assert.equal(isAllowedStaticPath('/src/main.js'), true);
  assert.equal(isAllowedStaticPath('/src/workflow.js'), true);
  assert.equal(isAllowedStaticPath('/.omx/context/private.md'), false);
  assert.equal(resolveStaticPath('/.omx/context/private.md', process.cwd()), null);

  await withServer(async (base) => {
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /<!doctype html>/i);

    const hidden = await fetch(`${base}/.omx/context/drawing-management-20260601T083750Z.md`);
    assert.equal(hidden.status, 404);

    const missing = await fetch(`${base}/missing.js`);
    assert.equal(missing.status, 404);
    assert.doesNotMatch(await missing.text(), /<!doctype html>/i);

    const workflow = await fetch(`${base}/src/workflow.js`);
    assert.equal(workflow.status, 200);
    assert.match(await workflow.text(), /buildDashboardModel/);

    const malformed = await fetch(`${base}/%E0%A4%A`);
    assert.equal(malformed.status, 400);

    const afterMalformed = await fetch(`${base}/`);
    assert.equal(afterMalformed.status, 200);
  });
});

test('asset API persists review workflow and demotes reviewed drawings after edits', async () => {
  await withServer(async (base) => {
    const shared = await fetch(`${base}/api/assets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'sales', action: 'share', asset: sampleAsset() }),
    }).then(response => response.json());
    assert.equal(shared.asset.reviewStatus, 'in_review');

    const denied = await fetch(`${base}/api/assets/drawing-test-1/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'sales', reviewStatus: 'approved' }),
    });
    assert.equal(denied.status, 403);

    const approved = await fetch(`${base}/api/assets/drawing-test-1/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'admin', reviewStatus: 'approved' }),
    }).then(response => response.json());
    assert.equal(approved.asset.reviewStatus, 'approved');
    assert.equal(approved.asset.comments.at(-1).system, true);

    const titledAsset = sampleAsset({
      title: '제목만 바꾼 도면',
      reviewStatus: 'approved',
      drawing: approved.asset.drawing,
      comments: approved.asset.comments,
    });
    const titled = await fetch(`${base}/api/assets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'sales', action: 'save', asset: titledAsset }),
    }).then(response => response.json());
    assert.equal(titled.asset.reviewStatus, 'draft');
    assert.match(titled.asset.comments.at(-1).text, /상태가 작성중/);

    const reshared = await fetch(`${base}/api/assets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'sales', action: 'share', asset: titled.asset }),
    }).then(response => response.json());
    assert.equal(reshared.asset.reviewStatus, 'in_review');

    const commented = await fetch(`${base}/api/assets/drawing-test-1/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'admin', text: '관리자 피드백을 저장합니다.' }),
    }).then(response => response.json());
    assert.equal(commented.asset.comments.at(-1).author, '관리자');
    assert.equal(commented.asset.comments.at(-1).text, '관리자 피드백을 저장합니다.');

    const reapproved = await fetch(`${base}/api/assets/drawing-test-1/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'admin', reviewStatus: 'approved' }),
    }).then(response => response.json());
    assert.equal(reapproved.asset.reviewStatus, 'approved');

    const editedAsset = sampleAsset({
      reviewStatus: 'approved',
      drawing: {
        ...approved.asset.drawing,
        dimensions: { ...approved.asset.drawing.dimensions, width: 700 },
      },
      comments: reapproved.asset.comments,
    });
    const edited = await fetch(`${base}/api/assets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'sales', action: 'save', asset: editedAsset }),
    }).then(response => response.json());
    assert.equal(edited.asset.reviewStatus, 'draft');
    assert.match(edited.asset.comments.at(-1).text, /상태가 작성중/);

    const list = await fetch(`${base}/api/assets`).then(response => response.json());
    assert.equal(list.assets.length, 1);
    assert.equal(list.assets[0].drawing.dimensions.width, 700);
    assert.ok(list.assets[0].comments.some(comment => comment.text === '관리자 피드백을 저장합니다.'));
  });
});

test('asset API rejects drawing items that the editor cannot render safely', async () => {
  await withServer(async (base) => {
    const invalidType = await fetch(`${base}/api/assets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        role: 'sales',
        action: 'save',
        asset: sampleAsset({
          drawing: {
            ...sampleAsset().drawing,
            items: [{ id: 'bad-1', type: 'unknown-widget', x: 10, y: 10, w: 20, h: 20 }],
          },
        }),
      }),
    });
    assert.equal(invalidType.status, 400);
    assert.match(await invalidType.text(), /Invalid drawing asset/);

    const invalidGeometry = await fetch(`${base}/api/assets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        role: 'sales',
        action: 'save',
        asset: sampleAsset({
          drawing: {
            ...sampleAsset().drawing,
            items: [{ id: 'bad-2', type: 'shelf', x: 10, y: 10, w: 0, h: 18 }],
          },
        }),
      }),
    });
    assert.equal(invalidGeometry.status, 400);
    assert.match(await invalidGeometry.text(), /Invalid drawing asset/);
  });
});
