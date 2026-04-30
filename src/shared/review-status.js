export const REVIEW_STATUS = Object.freeze({
  NEEDS_REVIEW: 'needs_review',
  BLOCKED_BY_TOOLING: 'blocked_by_tooling',
  BLOCKER: 'blocker',
  DWG_HEADER_INSPECTED: 'dwg_header_inspected',
  MECHANICALLY_CERTAIN: 'mechanically_certain',
});

export const SOURCE_KIND = Object.freeze({
  COMMON_LOGIC: 'common_logic',
  FILENAME_HINT: 'filename_hint',
  DWG_HEADER: 'dwg_header',
  DWG_ENTITY: 'dwg_entity',
  BLOCKED_BY_TOOLING: 'blocked_by_tooling',
  BLOCKER: 'blocker',
});

export function needsReview(sourceKind, reviewStatus) {
  return sourceKind !== SOURCE_KIND.DWG_ENTITY || reviewStatus !== 'mechanically_certain';
}

export function assertNoFalseDwgDerivedLabels(value, path = 'value') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoFalseDwgDerivedLabels(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;

  const label = String(value.label ?? value.sourceLabel ?? value.sourceKind ?? '').toLowerCase();
  if (label.includes('dwg-derived') || label.includes('dwg_derived')) {
    if (value.sourceKind !== SOURCE_KIND.DWG_ENTITY || value.reviewStatus !== 'mechanically_certain') {
      throw new Error(`${path} falsely labels uncertain data as DWG-derived`);
    }
  }

  for (const [key, child] of Object.entries(value)) {
    assertNoFalseDwgDerivedLabels(child, `${path}.${key}`);
  }
}
