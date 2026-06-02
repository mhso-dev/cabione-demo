export const REVIEW_STATUS_LABELS = {
  draft: '작성중',
  in_review: '검토중',
  approved: '승인',
  rejected: '반려',
};

export const ALLOWED_DRAWING_ITEM_TYPES = ['shelf', 'guidebar', 'outlet1', 'outlet2'];

const ADMIN_PRIORITY = {
  in_review: 0,
  rejected: 1,
  draft: 2,
  approved: 3,
};

const SALES_PRIORITY = {
  rejected: 0,
  draft: 1,
  in_review: 2,
  approved: 3,
};

export function statusLabel(status) {
  return REVIEW_STATUS_LABELS[status] ?? status ?? '작성중';
}

export function reviewStatusCounts(assets = []) {
  return assets.reduce((counts, asset) => {
    const status = asset?.reviewStatus ?? 'draft';
    counts.total += 1;
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {
    total: 0,
    draft: 0,
    in_review: 0,
    approved: 0,
    rejected: 0,
  });
}

export function latestComment(asset) {
  const comments = Array.isArray(asset?.comments) ? asset.comments : [];
  return comments.at(-1) ?? null;
}

export function latestCommentByRole(asset, role, { includeSystem = false } = {}) {
  const comments = Array.isArray(asset?.comments) ? asset.comments : [];
  return comments.findLast(comment => (
    comment?.role === role && (includeSystem || !comment?.system)
  )) ?? null;
}

export function assetActivityTime(asset) {
  const commentTime = latestComment(asset)?.createdAt;
  const candidates = [commentTime, asset?.updatedAt, asset?.sharedAt, asset?.createdAt]
    .map(value => new Date(value ?? 0).getTime())
    .filter(value => Number.isFinite(value));
  return Math.max(0, ...candidates);
}

export function formatThreadMessages(comments = []) {
  return comments.map((comment, index) => {
    const role = comment?.role === 'admin' ? 'admin' : 'sales';
    const system = Boolean(comment?.system);
    return {
      id: comment?.id ?? `message-${index}`,
      role,
      author: comment?.author ?? (role === 'admin' ? '관리자' : '영업 사원'),
      text: comment?.text ?? '',
      createdAt: comment?.createdAt ?? null,
      system,
      side: system ? 'system' : role,
    };
  });
}

export function deriveReviewQueue(assets = [], { role = 'admin', filter = 'all' } = {}) {
  const priorityMap = role === 'admin' ? ADMIN_PRIORITY : SALES_PRIORITY;
  return assets
    .filter(asset => filter === 'all' || asset?.reviewStatus === filter)
    .slice()
    .sort((left, right) => {
      const leftStatus = left?.reviewStatus ?? 'draft';
      const rightStatus = right?.reviewStatus ?? 'draft';
      const priorityDiff = (priorityMap[leftStatus] ?? 9) - (priorityMap[rightStatus] ?? 9);
      if (priorityDiff !== 0) return priorityDiff;
      return assetActivityTime(right) - assetActivityTime(left);
    });
}

export function deriveRoleNotifications(assets = [], { role = 'admin', limit = 6 } = {}) {
  const notifications = [];
  for (const asset of deriveReviewQueue(assets, { role, filter: 'all' })) {
    const comment = latestComment(asset);
    if (role === 'admin') {
      if (asset.reviewStatus === 'in_review') {
        notifications.push({
          id: `request-${asset.id}`,
          assetId: asset.id,
          kind: 'approval_request',
          tone: 'urgent',
          title: '승인 요청',
          text: `${asset.title} 도면 검토가 필요합니다.`,
          createdAt: asset.sharedAt ?? asset.updatedAt,
        });
      }
      const salesComment = latestCommentByRole(asset, 'sales');
      if (salesComment) {
        notifications.push({
          id: `sales-comment-${salesComment.id}`,
          assetId: asset.id,
          kind: 'sales_comment',
          tone: 'normal',
          title: '영업 댓글',
          text: `${asset.title}: ${salesComment.text}`,
          createdAt: salesComment.createdAt,
        });
      }
    } else {
      if (asset.reviewStatus === 'rejected') {
        notifications.push({
          id: `rejected-${asset.id}`,
          assetId: asset.id,
          kind: 'rejected',
          tone: 'urgent',
          title: '반려 피드백',
          text: `${asset.title} 도면 수정이 필요합니다.`,
          createdAt: asset.updatedAt,
        });
      } else if (asset.reviewStatus === 'approved') {
        notifications.push({
          id: `approved-${asset.id}`,
          assetId: asset.id,
          kind: 'approved',
          tone: 'success',
          title: '승인 완료',
          text: `${asset.title} 도면이 승인되었습니다.`,
          createdAt: asset.updatedAt,
        });
      }
      const adminComment = comment?.system && comment.role === 'admin'
        ? comment
        : latestCommentByRole(asset, 'admin', { includeSystem: true });
      if (adminComment && (adminComment.role === 'admin' || adminComment.system)) {
        notifications.push({
          id: `admin-feedback-${adminComment.id}`,
          assetId: asset.id,
          kind: 'admin_feedback',
          tone: asset.reviewStatus === 'approved' ? 'success' : 'normal',
          title: '관리자 피드백',
          text: `${asset.title}: ${adminComment.text}`,
          createdAt: adminComment.createdAt,
        });
      }
    }
    if (notifications.length >= limit) break;
  }

  return notifications.length ? notifications.slice(0, limit) : [{
    id: 'empty',
    assetId: null,
    kind: 'empty',
    tone: 'quiet',
    title: '새 알림 없음',
    text: role === 'admin'
      ? '검토 대기 도면이나 새 영업 댓글이 없습니다.'
      : '관리자 피드백이나 승인 결과가 없습니다.',
    createdAt: null,
  }];
}

export function formatAssetSubtitle(asset) {
  const templateName = asset?.drawing?.templateName || '직접 그리기';
  const dimensions = asset?.drawing?.dimensions ?? {};
  const size = [dimensions.width, dimensions.height, dimensions.depth]
    .filter(value => Number.isFinite(Number(value)))
    .join(' x ');
  return size ? `${templateName} · ${size} mm` : templateName;
}

export function buildDashboardModel(assets = [], {
  role = 'admin',
  filter = 'all',
  activeAssetId = null,
  notificationLimit = 6,
} = {}) {
  const queue = deriveReviewQueue(assets, { role, filter });
  const activeAsset = assets.find(asset => asset.id === activeAssetId) ?? queue[0] ?? null;
  return {
    role,
    filter,
    counts: reviewStatusCounts(assets),
    queue,
    activeAsset,
    notifications: deriveRoleNotifications(assets, { role, limit: notificationLimit }),
    thread: formatThreadMessages(activeAsset?.comments ?? []),
  };
}
