import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALLOWED_DRAWING_ITEM_TYPES,
  buildDashboardModel,
  deriveReviewQueue,
  deriveRoleNotifications,
  formatThreadMessages,
  reviewStatusCounts,
} from '../src/workflow.js';

function asset(id, reviewStatus, updatedAt, comments = []) {
  return {
    id,
    title: `${id} 도면`,
    reviewStatus,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt,
    sharedAt: reviewStatus === 'in_review' ? updatedAt : null,
    drawing: {
      templateName: '상부장',
      dimensions: { width: 600, height: 700, depth: 300 },
    },
    comments,
  };
}

const fixtures = [
  asset('draft-old', 'draft', '2026-06-01T01:00:00.000Z'),
  asset('request-new', 'in_review', '2026-06-01T04:00:00.000Z', [
    { id: 'c1', role: 'sales', author: '영업 사원', text: '고객이 콘센트 위치를 확인 요청했습니다.', createdAt: '2026-06-01T04:01:00.000Z' },
  ]),
  asset('approved', 'approved', '2026-06-01T02:00:00.000Z', [
    { id: 'c2', role: 'admin', author: '관리자', text: '승인했습니다.', createdAt: '2026-06-01T02:01:00.000Z', system: true },
  ]),
  asset('rejected', 'rejected', '2026-06-01T03:00:00.000Z', [
    { id: 'c3', role: 'admin', author: '관리자', text: '상판 길이를 줄여 주세요.', createdAt: '2026-06-01T03:01:00.000Z' },
  ]),
];

test('review status counts cover every dashboard bucket', () => {
  assert.deepEqual(ALLOWED_DRAWING_ITEM_TYPES, ['shelf', 'guidebar', 'outlet1', 'outlet2']);
  assert.deepEqual(reviewStatusCounts(fixtures), {
    total: 4,
    draft: 1,
    in_review: 1,
    approved: 1,
    rejected: 1,
  });
});

test('admin queue prioritizes active approval requests before other drawing states', () => {
  const queue = deriveReviewQueue(fixtures, { role: 'admin', filter: 'all' });
  assert.deepEqual(queue.map(item => item.id), ['request-new', 'rejected', 'draft-old', 'approved']);

  const filtered = deriveReviewQueue(fixtures, { role: 'admin', filter: 'in_review' });
  assert.deepEqual(filtered.map(item => item.id), ['request-new']);
});

test('sales queue prioritizes rejected drawings and administrator feedback', () => {
  const queue = deriveReviewQueue(fixtures, { role: 'sales', filter: 'all' });
  assert.deepEqual(queue.map(item => item.id), ['rejected', 'draft-old', 'request-new', 'approved']);

  const notifications = deriveRoleNotifications(fixtures, { role: 'sales' });
  assert.equal(notifications[0].kind, 'rejected');
  assert.ok(notifications.some(item => item.kind === 'admin_feedback'));
});

test('sales notifications do not label sales system reshare notes as admin feedback', () => {
  const notifications = deriveRoleNotifications([
    asset('reshared', 'in_review', '2026-06-01T05:00:00.000Z', [
      { id: 'a1', role: 'admin', author: '관리자', text: '콘센트 위치를 조정해 주세요.', createdAt: '2026-06-01T04:55:00.000Z' },
      { id: 's1', role: 'sales', author: '영업 사원', text: '검토 완료 후 도면이 수정되어 검토중으로 다시 공유되었습니다.', createdAt: '2026-06-01T05:00:00.000Z', system: true },
    ]),
  ], { role: 'sales' });

  assert.ok(notifications.some(item => item.kind === 'admin_feedback'));
  assert.match(notifications.find(item => item.kind === 'admin_feedback').text, /콘센트 위치/);
  assert.ok(!notifications.some(item => item.kind === 'admin_feedback' && /다시 공유/.test(item.text)));
});

test('admin notifications surface approval requests and sales comments', () => {
  const notifications = deriveRoleNotifications(fixtures, { role: 'admin' });
  assert.equal(notifications[0].kind, 'approval_request');
  assert.match(notifications[0].text, /검토가 필요/);
  assert.ok(notifications.some(item => item.kind === 'sales_comment'));
  assert.match(notifications.find(item => item.kind === 'sales_comment').text, /콘센트 위치/);
});

test('dashboard model returns the active thread as chat-ready messages', () => {
  const model = buildDashboardModel(fixtures, {
    role: 'admin',
    filter: 'all',
    activeAssetId: 'rejected',
  });
  assert.equal(model.activeAsset.id, 'rejected');
  assert.equal(model.counts.total, 4);
  assert.equal(model.thread[0].side, 'admin');
  assert.equal(model.thread[0].text, '상판 길이를 줄여 주세요.');
});

test('thread messages preserve chronological order and mark system messages', () => {
  const messages = formatThreadMessages([
    { id: 'a', role: 'sales', author: '영업', text: '문의', createdAt: '2026-06-01T01:00:00.000Z' },
    { id: 'b', role: 'admin', author: '관리자', text: '승인', createdAt: '2026-06-01T02:00:00.000Z', system: true },
  ]);
  assert.deepEqual(messages.map(message => message.side), ['sales', 'system']);
});
