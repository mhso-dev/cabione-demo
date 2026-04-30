import manifest from '../data/templateManifest.json' with { type: 'json' };
import { FAMILY_LABELS, makeDefaultDimensions, makeDefaultOptions } from '../rules/familyConstraints.js';

export async function loadTemplates() {
  const entries = manifest.templates ?? manifest.items ?? [];
  return Promise.all(entries.map(async (entry) => {
    if (entry.template) return entry.template;
    const mod = await import(`../${entry.path.replace(/^src\//, '')}`, { with: { type: 'json' } });
    return mod.default;
  }));
}

export function createProject(template) {
  const now = new Date().toISOString();
  const familyId = familyIdFromTemplate(template);
  return {
    projectId: `cabione-${Date.now()}`,
    templateId: template.templateId ?? template.id,
    family: familyId,
    dimensions: { ...makeDefaultDimensions(familyId), ...(template.defaults?.dimensions ?? {}) },
    options: { ...makeDefaultOptions(familyId), ...(template.defaults?.options ?? {}) },
    outputs: { pdfGenerated: false, captureGenerated: false },
    metadata: { schemaVersion: 1, createdAt: now, updatedAt: now, consultationGradeOnly: true, dwgAutomationRequired: false },
  };
}

export function familyIdFromTemplate(template) {
  if (template.familyId) return template.familyId;
  const label = template.familyDisplayName ?? template.family;
  const match = Object.entries(FAMILY_LABELS).find(([, familyLabel]) => familyLabel === label);
  if (!match) throw new Error(`Unknown template family: ${label ?? 'missing'}`);
  return match[0];
}
