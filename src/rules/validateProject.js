import { allowedDoorCounts, getFamilyRules, makeDefaultDimensions, makeDefaultOptions } from './familyConstraints.js';
import { getTrackATemplate } from '../data/templates/track-a-draft-templates.js';

function fieldValue(value) {
  if (value && typeof value === 'object' && 'value' in value) return value.value;
  return value;
}

function normalizedFamilyId(templateOrProject) {
  const family = fieldValue(templateOrProject?.familyId ?? templateOrProject?.family ?? templateOrProject?.familyDisplayName ?? templateOrProject?.familyHint);
  const map = {
    하부장: 'base_cabinet',
    상부장: 'wall_cabinet',
    슬라이징장: 'sliding_cabinet',
    '3도어장': 'three_door_cabinet',
    플랩장: 'flap_cabinet',
    lower_cabinet: 'base_cabinet',
    upper_cabinet: 'wall_cabinet',
  };
  return map[family] ?? family;
}

function familyDisplayName(template) {
  const familyId = normalizedFamilyId(template);
  return getFamilyRules(familyId)?.displayName ?? fieldValue(template?.familyDisplayName ?? template?.family) ?? familyId;
}

function dimensionRule(template, name) {
  const direct = template?.dimensions?.[name];
  const nested = template?.constraints?.dimensions?.[name];
  const legacy = template?.constraints?.[name] ?? template?.constraints?.[`${name}_mm`];
  const rule = direct ?? nested ?? legacy;
  if (!rule) return null;
  return {
    min: Number(fieldValue(rule.min)),
    max: Number(fieldValue(rule.max)),
    step: Number(fieldValue(rule.step) ?? 1),
    default: Number(fieldValue(rule.default)),
    reviewStatus: rule.reviewStatus ?? rule.review_status ?? rule.min?.review_status ?? rule.min?.reviewStatus ?? template?.constraints?.reviewStatus,
  };
}

function valuesFromRule(rule) {
  if (!rule) return [];
  if (Array.isArray(rule.values)) return rule.values;
  if (Array.isArray(rule)) return rule;
  if (Number.isFinite(rule.min) && Number.isFinite(rule.max)) {
    return Array.from({ length: rule.max - rule.min + 1 }, (_, index) => rule.min + index);
  }
  return [];
}

export function getOptionAvailability(project, template) {
  const familyId = normalizedFamilyId(template ?? project);
  const rules = getFamilyRules(familyId);
  const width = Number(project?.dimensions?.width ?? template?.defaults?.dimensions?.width ?? rules?.dimensions?.width?.default ?? 0);
  const doorValues = allowedDoorCounts(familyId, width);
  const mountValues = rules?.options?.mountType?.values ?? [];
  const flapValues = valuesFromRule(rules?.options?.flapCount);
  const panelValues = valuesFromRule(rules?.options?.slidingPanelCount);
  const slidingState = rules?.options?.sliding?.state ?? 'unavailable';
  return {
    doorCount: {
      values: doorValues,
      disabled: doorValues.length === 1 && doorValues[0] === 0,
      reason: doorValues.length === 1 && doorValues[0] === 0 ? '이 제품군은 여닫이 도어 수를 사용하지 않습니다.' : null,
    },
    mountType: {
      values: mountValues,
      disabled: mountValues.length <= 1,
      reason: mountValues.length <= 1 ? '이 제품군의 설치 방식은 초안 규칙에서 고정되어 있습니다.' : null,
    },
    flapCount: {
      values: flapValues,
      disabled: flapValues.length === 1 && flapValues[0] === 0,
      reason: flapValues.length === 1 && flapValues[0] === 0 ? '이 제품군은 플랩 옵션을 사용하지 않습니다.' : null,
    },
    sliding: {
      state: slidingState,
      required: slidingState === 'required',
      disabled: slidingState !== 'available',
      reason: slidingState === 'required' ? '슬라이징장은 슬라이딩 사용이 필수입니다.' : slidingState === 'unavailable' ? '이 제품군은 슬라이딩을 지원하지 않습니다.' : null,
    },
    slidingPanelCount: {
      values: panelValues,
      disabled: panelValues.length === 1 && panelValues[0] === 0,
      reason: panelValues.length === 1 && panelValues[0] === 0 ? '슬라이딩 패널 옵션이 없습니다.' : null,
    },
  };
}

export function createProject(template) {
  const now = new Date().toISOString();
  if (typeof template === 'string' && template.startsWith('track-a-')) {
    const trackTemplate = getTrackATemplate(template);
    return {
      projectId: `cabione-${Date.now()}`,
      templateId: trackTemplate.id,
      family: trackTemplate.family,
      dimensions: Object.fromEntries(Object.entries(trackTemplate.dimensions).map(([key, rule]) => [key, rule.defaultValue])),
      options: Object.fromEntries(Object.entries(trackTemplate.options).map(([key, values]) => [key, values.find((item) => item.enabled)?.value ?? values[0]?.value])),
      metadata: { schemaVersion: 1, createdAt: now, updatedAt: now, consultationGradeOnly: true, dwgAutomationRequired: false },
    };
  }
  const templateId = typeof template === 'string' ? template : (template.templateId ?? template.id);
  const familyId = typeof template === 'string' ? familyIdFromTemplateId(template) : normalizedFamilyId(template);
  return {
    projectId: `cabione-${Date.now()}`,
    templateId,
    family: familyId,
    dimensions: { ...makeDefaultDimensions(familyId), ...(typeof template === 'string' ? {} : template.defaults?.dimensions ?? {}) },
    options: { ...makeDefaultOptions(familyId), ...(typeof template === 'string' ? {} : template.defaults?.options ?? {}) },
    outputs: { pdfGenerated: false, captureGenerated: false },
    metadata: { schemaVersion: 1, createdAt: now, updatedAt: now, consultationGradeOnly: true, dwgAutomationRequired: false },
  };
}

function familyIdFromTemplateId(templateId) {
  const id = String(templateId).normalize('NFC');
  if (id.includes('하부장') || id.includes('base')) return 'base_cabinet';
  if (id.includes('상부장') || id.includes('wall') || id.includes('upper')) return 'wall_cabinet';
  if (id.includes('슬라이징장') || id.includes('sliding')) return 'sliding_cabinet';
  if (id.includes('3도어장') || id.includes('three')) return 'three_door_cabinet';
  if (id.includes('플랩장') || id.includes('flap')) return 'flap_cabinet';
  return 'base_cabinet';
}

export function updateProject(project, patch) {
  return {
    ...project,
    dimensions: { ...project.dimensions, ...(patch.dimensions ?? {}) },
    options: { ...project.options, ...(patch.options ?? {}) },
    metadata: { ...(project.metadata ?? {}), updatedAt: new Date().toISOString() },
  };
}

export function validateProject(project, template) {
  if (template?.track === 'A') return validateTrackAProject(project, template);
  const errors = [];
  const warnings = [];
  const dimensions = project?.dimensions ?? {};
  const familyId = normalizedFamilyId(template ?? project);
  const label = familyDisplayName(template ?? project);

  for (const name of ['width', 'height', 'depth']) {
    const rule = dimensionRule(template ?? {}, name) ?? getFamilyRules(familyId)?.dimensions?.[name];
    if (!rule) continue;
    const value = Number(dimensions[name]);
    const korean = { width: '폭', height: '높이', depth: '깊이' }[name];
    if (!Number.isFinite(value)) {
      errors.push(`${korean}은 숫자로 입력해야 합니다.`);
      continue;
    }
    if (Number.isFinite(rule.min) && value < rule.min) errors.push(`${korean} ${value}mm는 최소 ${rule.min}mm보다 작습니다.`);
    if (Number.isFinite(rule.max) && value > rule.max) errors.push(`${korean} ${value}mm는 최대 ${rule.max}mm보다 큽니다.`);
    if (Number.isFinite(rule.step) && rule.step > 0 && Number.isFinite(rule.min) && (value - rule.min) % rule.step !== 0) {
      errors.push(`${korean} ${value}mm는 ${rule.step}mm 단위로 입력해야 합니다.`);
    }
    if (rule.reviewStatus === 'needs_review') warnings.push(`${korean} constraint는 needs_review 초안입니다.`);
  }

  const availability = getOptionAvailability(project, template ?? project);
  const options = project?.options ?? {};
  const checks = [
    ['doorCount', Number(options.doorCount ?? 0), availability.doorCount, '도어 수'],
    ['flapCount', Number(options.flapCount ?? 0), availability.flapCount, '플랩 수'],
    ['slidingPanelCount', Number(options.slidingPanelCount ?? 0), availability.slidingPanelCount, '슬라이딩 패널 수'],
  ];
  for (const [, selected, rule, labelText] of checks) {
    if (!rule.values.includes(selected)) errors.push(`${labelText} ${selected}은(는) ${label}에서 선택할 수 없습니다. 가능 값: ${rule.values.join(', ')}`);
  }
  if (!availability.mountType.values.includes(options.mountType)) {
    errors.push(`설치 방식 ${options.mountType}은(는) ${label}에서 선택할 수 없습니다.`);
  }
  if (availability.sliding.required && options.sliding !== true) errors.push('슬라이징장은 슬라이딩 사용이 필수입니다.');
  if (availability.sliding.state === 'unavailable' && options.sliding === true) errors.push(`${label}은(는) 슬라이딩을 지원하지 않습니다.`);

  if (template?.reviewStatus === 'needs_review' || template?.constraints?.reviewStatus === 'needs_review') {
    warnings.push('이 템플릿은 samples 파일을 참고한 상담용 초안이며 needs_review 상태입니다.');
  }

  return {
    valid: errors.length === 0,
    status: errors.length === 0 ? 'valid' : 'invalid',
    errors,
    messages: errors,
    warnings,
    reviewStatus: template?.reviewStatus ?? template?.review_status ?? template?.review?.status ?? 'needs_review',
    optionAvailability: availability,
  };
}

export default validateProject;

function validateTrackAProject(project, template) {
  const errors = [];
  const warnings = [];
  for (const [name, rule] of Object.entries(template.dimensions ?? {})) {
    const value = Number(project.dimensions?.[name]);
    const label = { width: '폭', height: '높이', depth: '깊이' }[name] ?? name;
    if (!Number.isFinite(value)) errors.push(`${label}은 숫자로 입력해야 합니다.`);
    else {
      if (value < rule.min || value > rule.max) errors.push(`${label} ${value}${rule.unit ?? 'mm'}는 ${rule.min}-${rule.max}${rule.unit ?? 'mm'} 범위를 벗어납니다.`);
      if ((value - rule.min) % rule.step !== 0) errors.push(`${label} ${value}${rule.unit ?? 'mm'}는 ${rule.step}${rule.unit ?? 'mm'} 단위로 입력해야 합니다.`);
    }
    if (rule.reviewStatus === 'needs_review') warnings.push(`${label} constraint는 needs_review 초안입니다.`);
  }
  for (const [optionName, selected] of Object.entries(project.options ?? {})) {
    const allowed = template.options?.[optionName] ?? [];
    const match = allowed.find((item) => item.value === selected);
    if (!match) errors.push(`${optionName} 옵션 ${selected}은(는) ${template.family}에서 선택할 수 없습니다.`);
    if (match && !match.enabled) errors.push(`${optionName} 옵션 ${selected}은 비활성입니다: ${match.disabledReason}`);
  }
  if (template.sliding?.state === 'required' && project.options?.sliding === false) errors.push('슬라이딩장은 슬라이딩 사용이 필수입니다.');
  return {
    valid: errors.length === 0,
    status: errors.length === 0 ? 'valid' : 'invalid',
    errors,
    messages: errors,
    warnings,
    reviewStatus: template.reviewStatus ?? 'needs_review',
    optionAvailability: {},
  };
}
