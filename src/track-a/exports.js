import { canExport, serializeProject } from './rules.js';
import { deriveDrawingModel, dimensionRows, renderSvg } from './drawing.js';

export function buildPrintableHtml(project, template) {
  const exportState = canExport(project, template);
  if (!exportState.ok) throw new Error(`Cannot export invalid project: ${exportState.validation.errors.join('; ')}`);
  const model = deriveDrawingModel(project, template);
  const rows = dimensionRows(model).map(([name, value, unit]) => `<tr><th>${name}</th><td>${value}</td><td>${unit}</td></tr>`).join('');
  return `<section class="capture-sheet" data-track="A">
    <h1>Cabione 상담 도면</h1>
    ${renderSvg(model)}
    <table>${rows}</table>
    <p class="warning">상담용 2D schematic이며 production CAD가 아닙니다. 모든 초안 값은 needs_review입니다.</p>
  </section>`;
}

export function exportProjectJson(project) {
  const exportState = canExport(project);
  if (!exportState.ok) throw new Error(`Cannot export invalid project: ${exportState.validation.errors.join('; ')}`);
  return serializeProject(project);
}

export function buildCapturePayload(project, template) {
  const html = buildPrintableHtml(project, template);
  return {
    fileName: `cabione-${project.family}-capture.html`,
    mimeType: 'text/html;charset=utf-8',
    content: html,
  };
}
