import { validateProject } from '../rules/validateProject.js';

export function canExportProjectJson(project, template) {
  const validation = validateProject(project, template);
  return { ok: validation.valid, valid: validation.valid, validation, precondition: '프로젝트가 유효해야 JSON으로 내보낼 수 있습니다.' };
}

export function exportProjectJson(project, template) {
  const precondition = canExportProjectJson(project, template);
  if (!precondition.ok) throw new Error(`유효하지 않은 프로젝트는 JSON으로 내보낼 수 없습니다: ${precondition.validation.errors.join('; ')}`);
  return JSON.stringify({ ...project, validation: precondition.validation, exportedAt: new Date().toISOString() }, null, 2);
}

export function importProjectJson(text) {
  const project = JSON.parse(text);
  if (!project.projectId || !project.templateId || !project.dimensions || !project.options) {
    throw new Error('프로젝트 JSON 가져오기 실패: projectId/templateId/dimensions/options가 필요합니다.');
  }
  return project;
}
