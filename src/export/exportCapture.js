import { validateProject } from '../rules/validateProject.js';
import { buildDrawingModel } from '../render/buildDrawingModel.js';
import { renderSvg } from '../render/renderSvg.js';
import { renderDimensionTable } from '../render/renderDimensionTable.js';

export function canExportCapture(project, template) {
  const validation = validateProject(project, template);
  return { ok: validation.valid, valid: validation.valid, validation, precondition: 'project must be valid before capture export' };
}

export function exportCapture(project, template, drawingModel = buildDrawingModel(project, template)) {
  const state = canExportCapture(project, template);
  if (!state.ok) throw new Error(`유효하지 않은 프로젝트는 캡처로 내보낼 수 없습니다: ${state.validation.errors.join('; ')}`);
  const content = `<section class="capture-sheet" data-track="A"><h1>${drawingModel.familyDisplayName}</h1>${renderSvg(drawingModel)}${renderDimensionTable(drawingModel)}<p>상담용 2D 도식 · needs_review · production CAD 아님</p></section>`;
  return { mimeType: 'text/html;charset=utf-8', fileName: `${project.projectId ?? 'cabione'}-capture.html`, content, drawing: drawingModel };
}
