import { validateProject } from '../rules/validateProject.js';
import { buildDrawingModel } from '../render/buildDrawingModel.js';
import { renderSvg } from '../render/renderSvg.js';
import { renderDimensionTable } from '../render/renderDimensionTable.js';

export function canExportPdf(project, template) {
  const validation = validateProject(project, template);
  return { ok: validation.valid, valid: validation.valid, validation, precondition: 'project must be valid before PDF export' };
}

export function exportPdf(project, template, drawingModel = buildDrawingModel(project, template)) {
  const state = canExportPdf(project, template);
  if (!state.ok) throw new Error(`유효하지 않은 프로젝트는 PDF로 내보낼 수 없습니다: ${state.validation.errors.join('; ')}`);
  return {
    mimeType: 'text/html;charset=utf-8',
    fileName: `${project.projectId ?? 'cabione'}-consultation-print.html`,
    content: printableConsultationSheet(project, template, drawingModel),
    printRecommended: true,
  };
}

function printableConsultationSheet(project, template, model) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Cabione 상담 도면</title><style>body{font-family:system-ui,sans-serif;margin:24px;color:#111827}svg{max-width:100%;border:1px solid #cbd5e1}.dimension-table{border-collapse:collapse;width:100%;margin-top:16px}.dimension-table th,.dimension-table td{border:1px solid #cbd5e1;padding:8px;text-align:left}.warning{color:#92400e;background:#fef3c7;padding:10px;border-radius:8px}</style></head><body><h1>${model.familyDisplayName} 상담 도면</h1><p class="warning">상담용 2D 도식 · production CAD 아님 · 초안 constraints needs_review · DWG 자동 해석 완료를 기다리지 않습니다.</p>${renderSvg(model)}${renderDimensionTable(model)}<pre>${escapeHtml(JSON.stringify({ project, templateId: template.templateId ?? template.id }, null, 2))}</pre></body></html>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
}
