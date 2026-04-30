import { trackADraftTemplates, getTrackATemplate } from '../data/templates/track-a-draft-templates.js';
import { createProject, deserializeProject, updateProject, validateProject } from './rules.js';
import { deriveDrawingModel, dimensionRows, renderSvg } from './drawing.js';
import { buildCapturePayload, buildPrintableHtml, exportProjectJson } from './exports.js';

let project = createProject(trackADraftTemplates[0].id);

const app = document.querySelector('#app');
render();

function render() {
  const template = getTrackATemplate(project.templateId);
  const validation = validateProject(project, template);
  const model = deriveDrawingModel(project, template);
  app.innerHTML = `
    <h1>Cabione 현장 상담 CAD MVP</h1>
    <p class="warning">Track A UI MVP: DWG 자동 해석 완료를 기다리지 않는 상담용 2D schematic입니다. 초안 constraints는 needs_review입니다.</p>
    <section class="grid">
      <div class="panel controls">
        <label>제품군/템플릿
          <select id="template">${trackADraftTemplates.map((item) => `<option value="${item.id}" ${item.id === template.id ? 'selected' : ''}>${item.family} — ${item.displayName}</option>`).join('')}</select>
        </label>
        ${dimensionInput('width', '폭(W)', project.dimensions.width)}
        ${dimensionInput('height', '높이(H)', project.dimensions.height)}
        ${dimensionInput('depth', '깊이(D)', project.dimensions.depth)}
        ${optionInputs(template)}
        <div>${validation.valid ? '<p class="ok">유효한 상담 초안입니다.</p>' : `<p class="error">${validation.errors.join('<br>')}</p>`}</div>
        <p class="warning">슬라이딩: ${template.sliding.state} — ${template.sliding.reason}</p>
        <button id="print" ${validation.valid ? '' : 'disabled'}>PDF/Print export</button>
        <button id="json" class="secondary" ${validation.valid ? '' : 'disabled'}>Project JSON export</button>
        <button id="capture" class="secondary" ${validation.valid ? '' : 'disabled'}>Capture export</button>
        <label>JSON import/export
          <textarea id="projectJson">${escapeHtml(JSON.stringify(project, null, 2))}</textarea>
        </label>
        <button id="import" class="secondary">Import JSON</button>
      </div>
      <div class="panel" id="captureArea">
        ${renderSvg(model)}
        ${dimensionTable(model)}
        <details open><summary>Debug / review warnings</summary><pre>${escapeHtml(JSON.stringify(validation, null, 2))}</pre></details>
      </div>
    </section>
  `;
  bind(template);
}

function dimensionInput(name, label, value) {
  return `<label>${label}<input data-dimension="${name}" type="number" value="${value}" /></label>`;
}

function optionInputs(template) {
  return Object.entries(template.options).map(([name, options]) => `<label>${name}<select data-option="${name}">${options.map((option) => `<option value="${option.value}" ${project.options[name] === option.value ? 'selected' : ''} ${option.enabled ? '' : 'disabled'}>${option.label}${option.enabled ? '' : ` (${option.disabledReason})`}</option>`).join('')}</select></label>`).join('');
}

function dimensionTable(model) {
  return `<table><tbody>${dimensionRows(model).map(([name, value, unit]) => `<tr><th>${name}</th><td>${value}</td><td>${unit}</td></tr>`).join('')}</tbody></table>`;
}

function bind(template) {
  document.querySelector('#template').addEventListener('change', (event) => {
    project = createProject(event.target.value);
    render();
  });
  document.querySelectorAll('[data-dimension]').forEach((input) => input.addEventListener('change', (event) => {
    project = updateProject(project, { dimensions: { [event.target.dataset.dimension]: Number(event.target.value) } });
    render();
  }));
  document.querySelectorAll('[data-option]').forEach((input) => input.addEventListener('change', (event) => {
    project = updateProject(project, { options: { [event.target.dataset.option]: parseOption(event.target.value) } });
    render();
  }));
  document.querySelector('#print').addEventListener('click', () => {
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`<!doctype html><title>Cabione 상담 도면</title><link rel="stylesheet" href="./src/track-a/styles.css">${buildPrintableHtml(project, template)}`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  });
  document.querySelector('#json').addEventListener('click', () => download('cabione-project.json', exportProjectJson(project), 'application/json'));
  document.querySelector('#capture').addEventListener('click', () => {
    const payload = buildCapturePayload(project, template);
    download(payload.fileName, payload.content, payload.mimeType);
  });
  document.querySelector('#import').addEventListener('click', () => {
    project = deserializeProject(document.querySelector('#projectJson').value);
    render();
  });
}

function parseOption(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && String(numeric) === value ? numeric : value;
}

function download(fileName, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(href);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
}
