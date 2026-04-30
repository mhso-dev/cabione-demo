import { getTrackATemplate } from '../data/templates/track-a-draft-templates.js';
import { assertTrackAIsIndependent } from '../shared/track-boundaries.js';

export function createProject(templateId) {
  assertTrackAIsIndependent();
  const template = getTrackATemplate(templateId);
  const project = {
    schemaVersion: 1,
    track: 'A',
    templateId: template.id,
    family: template.family,
    dimensions: Object.fromEntries(Object.entries(template.dimensions).map(([key, config]) => [key, config.defaultValue])),
    options: defaultOptions(template),
    metadata: {
      consultationGradeOnly: true,
      dwgAutomationRequired: false,
      reviewStatus: template.reviewStatus,
    },
  };
  return project;
}

export function defaultOptions(template) {
  return Object.fromEntries(
    Object.entries(template.options).map(([key, values]) => [key, values.find((item) => item.enabled)?.value ?? values[0]?.value]),
  );
}

export function validateProject(project, template = getTrackATemplate(project.templateId)) {
  const errors = [];
  const warnings = [];

  if (project.track !== 'A') errors.push('Track A project must keep track="A".');
  if (project.metadata?.dwgAutomationRequired) errors.push('Track A cannot require DWG automation.');

  for (const [dimensionName, rule] of Object.entries(template.dimensions)) {
    const value = Number(project.dimensions?.[dimensionName]);
    if (!Number.isFinite(value)) {
      errors.push(`${dimensionName} must be numeric.`);
      continue;
    }
    if (value < rule.min || value > rule.max) {
      errors.push(`${dimensionName} ${value}${rule.unit} is outside ${rule.min}-${rule.max}${rule.unit}.`);
    }
    if ((value - rule.min) % rule.step !== 0) {
      errors.push(`${dimensionName} ${value}${rule.unit} must follow ${rule.step}${rule.unit} increments.`);
    }
    if (rule.reviewStatus === 'needs_review') {
      warnings.push(`${dimensionName} constraint is a draft rule that needs review.`);
    }
  }

  for (const [optionName, selected] of Object.entries(project.options ?? {})) {
    const allowed = template.options[optionName] ?? [];
    const match = allowed.find((item) => item.value === selected);
    if (!match) errors.push(`${optionName} option ${selected} is not available for ${template.family}.`);
    if (match && !match.enabled) errors.push(`${optionName} option ${selected} disabled: ${match.disabledReason}`);
  }

  if (template.sliding.state === 'required' && template.family !== '슬라이징장') {
    errors.push('Sliding cannot be required for a non-sliding family in Track A draft rules.');
  }

  return { valid: errors.length === 0, errors, warnings, sliding: template.sliding, reviewStatus: template.reviewStatus };
}

export function updateProject(project, patch) {
  return {
    ...project,
    dimensions: { ...project.dimensions, ...patch.dimensions },
    options: { ...project.options, ...patch.options },
  };
}

export function canExport(project, template = getTrackATemplate(project.templateId)) {
  const validation = validateProject(project, template);
  return { ok: validation.valid, validation };
}

export function serializeProject(project) {
  return JSON.stringify(project, null, 2);
}

export function deserializeProject(json) {
  const parsed = JSON.parse(json);
  const template = getTrackATemplate(parsed.templateId);
  const validation = validateProject(parsed, template);
  if (!validation.valid) {
    throw new Error(`Imported project is invalid: ${validation.errors.join('; ')}`);
  }
  return parsed;
}
