export const FAMILY_ORDER = ['base_cabinet', 'wall_cabinet', 'sliding_cabinet', 'three_door_cabinet', 'flap_cabinet'];

export const FAMILY_LABELS = {
  base_cabinet: '하부장',
  wall_cabinet: '상부장',
  sliding_cabinet: '슬라이징장',
  three_door_cabinet: '3도어장',
  flap_cabinet: '플랩장',
};

export const FAMILY_RULES = {
  base_cabinet: {
    familyId: 'base_cabinet',
    displayName: '하부장',
    reviewStatus: 'needs_review',
    dimensions: {
      width: { min: 400, max: 1500, step: 10, default: 800, reviewStatus: 'needs_review' },
      height: { min: 350, max: 900, step: 10, default: 720, reviewStatus: 'needs_review' },
      depth: { min: 350, max: 600, step: 10, default: 560, reviewStatus: 'needs_review' },
    },
    options: {
      doorCount: { min: 1, max: 5, default: 2, reviewStatus: 'needs_review' },
      mountType: { values: ['legged', 'wall_mounted'], default: 'legged', reviewStatus: 'needs_review' },
      flapCount: { values: [0], default: 0, reviewStatus: 'needs_review' },
      sliding: { state: 'unavailable', default: false, reviewStatus: 'needs_review' },
      slidingPanelCount: { values: [0], default: 0, reviewStatus: 'needs_review' },
    },
    doorCountForWidth(width) {
      if (width <= 600) return [1, 2];
      if (width <= 900) return [2, 3];
      if (width <= 1200) return [3, 4];
      return [4, 5];
    },
  },
  wall_cabinet: {
    familyId: 'wall_cabinet',
    displayName: '상부장',
    reviewStatus: 'needs_review',
    dimensions: {
      width: { min: 300, max: 1200, step: 10, default: 800, reviewStatus: 'needs_review' },
      height: { min: 300, max: 900, step: 10, default: 600, reviewStatus: 'needs_review' },
      depth: { min: 120, max: 250, step: 10, default: 170, reviewStatus: 'needs_review' },
    },
    options: {
      doorCount: { min: 1, max: 4, default: 2, reviewStatus: 'needs_review' },
      mountType: { values: ['wall_mounted'], default: 'wall_mounted', reviewStatus: 'needs_review' },
      flapCount: { values: [0], default: 0, reviewStatus: 'needs_review' },
      sliding: { state: 'unavailable', default: false, reviewStatus: 'needs_review' },
      slidingPanelCount: { values: [0], default: 0, reviewStatus: 'needs_review' },
    },
    doorCountForWidth(width) {
      if (width <= 450) return [1];
      if (width <= 800) return [1, 2];
      return [2, 3, 4];
    },
  },
  sliding_cabinet: {
    familyId: 'sliding_cabinet',
    displayName: '슬라이징장',
    reviewStatus: 'needs_review',
    dimensions: {
      width: { min: 600, max: 1800, step: 10, default: 1200, reviewStatus: 'needs_review' },
      height: { min: 400, max: 1200, step: 10, default: 900, reviewStatus: 'needs_review' },
      depth: { min: 120, max: 350, step: 10, default: 250, reviewStatus: 'needs_review' },
    },
    options: {
      doorCount: { values: [0], default: 0, reviewStatus: 'needs_review' },
      mountType: { values: ['wall_mounted'], default: 'wall_mounted', reviewStatus: 'needs_review' },
      flapCount: { values: [0], default: 0, reviewStatus: 'needs_review' },
      sliding: { state: 'required', default: true, reviewStatus: 'needs_review' },
      slidingPanelCount: { values: [2, 3], default: 2, reviewStatus: 'needs_review' },
    },
  },
  three_door_cabinet: {
    familyId: 'three_door_cabinet',
    displayName: '3도어장',
    reviewStatus: 'needs_review',
    dimensions: {
      width: { min: 900, max: 1800, step: 10, default: 1200, reviewStatus: 'needs_review' },
      height: { min: 350, max: 900, step: 10, default: 720, reviewStatus: 'needs_review' },
      depth: { min: 350, max: 650, step: 10, default: 560, reviewStatus: 'needs_review' },
    },
    options: {
      doorCount: { values: [3], default: 3, reviewStatus: 'needs_review' },
      mountType: { values: ['legged', 'wall_mounted'], default: 'legged', reviewStatus: 'needs_review' },
      flapCount: { values: [0], default: 0, reviewStatus: 'needs_review' },
      sliding: { state: 'unavailable', default: false, reviewStatus: 'needs_review' },
      slidingPanelCount: { values: [0], default: 0, reviewStatus: 'needs_review' },
    },
  },
  flap_cabinet: {
    familyId: 'flap_cabinet',
    displayName: '플랩장',
    reviewStatus: 'needs_review',
    dimensions: {
      width: { min: 450, max: 1200, step: 10, default: 800, reviewStatus: 'needs_review' },
      height: { min: 300, max: 800, step: 10, default: 450, reviewStatus: 'needs_review' },
      depth: { min: 250, max: 450, step: 10, default: 350, reviewStatus: 'needs_review' },
    },
    options: {
      doorCount: { values: [0], default: 0, reviewStatus: 'needs_review' },
      mountType: { values: ['wall_mounted'], default: 'wall_mounted', reviewStatus: 'needs_review' },
      flapCount: { values: [1, 2], default: 1, reviewStatus: 'needs_review' },
      sliding: { state: 'unavailable', default: false, reviewStatus: 'needs_review' },
      slidingPanelCount: { values: [0], default: 0, reviewStatus: 'needs_review' },
    },
  },
};

export function getFamilyRules(familyId) {
  const normalized = familyId === 'lower_cabinet' ? 'base_cabinet' : familyId === 'upper_cabinet' ? 'wall_cabinet' : familyId;
  return FAMILY_RULES[normalized];
}

export function allowedDoorCounts(familyId, width) {
  const rules = getFamilyRules(familyId);
  if (!rules) return [];
  const doorRule = rules.options.doorCount;
  if (typeof rules.doorCountForWidth === 'function') return rules.doorCountForWidth(Number(width));
  if (Array.isArray(doorRule.values)) return doorRule.values;
  const values = [];
  for (let value = doorRule.min; value <= doorRule.max; value += 1) values.push(value);
  return values;
}

export function makeDefaultOptions(familyId) {
  const rules = getFamilyRules(familyId);
  return Object.fromEntries(Object.entries(rules.options).map(([key, rule]) => [key, rule.default]));
}

export function makeDefaultDimensions(familyId) {
  const rules = getFamilyRules(familyId);
  return Object.fromEntries(Object.entries(rules.dimensions).map(([key, rule]) => [key, rule.default]));
}
