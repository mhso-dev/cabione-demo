import { getTrackATemplate } from '../data/templates/track-a-draft-templates.js';

export function deriveDrawingModel(project, template = getTrackATemplate(project.templateId)) {
  const { width, height, depth } = project.dimensions;
  const scale = Math.min(480 / width, 260 / height);
  const body = { x: 40, y: 30, width: Math.round(width * scale), height: Math.round(height * scale) };
  const divisions = divisionCount(project, template);
  return {
    family: template.family,
    consultationGradeOnly: true,
    reviewStatus: template.reviewStatus,
    dimensions: { width, height, depth },
    body,
    divisions,
    sliding: template.sliding,
    labels: [`W ${width}mm`, `H ${height}mm`, `D ${depth}mm`, template.family],
  };
}

function divisionCount(project, template) {
  return Number(project.options.doorCount ?? project.options.panelCount ?? project.options.flapCount ?? (template.family === '슬라이징장' ? 2 : 1));
}

export function renderSvg(model) {
  const lines = [];
  for (let index = 1; index < model.divisions; index += 1) {
    const x = model.body.x + Math.round((model.body.width / model.divisions) * index);
    lines.push(`<line x1="${x}" y1="${model.body.y}" x2="${x}" y2="${model.body.y + model.body.height}" />`);
  }
  const slidingCue = model.sliding.state === 'required'
    ? `<path d="M ${model.body.x + 15} ${model.body.y + model.body.height - 22} H ${model.body.x + model.body.width - 15}" class="rail" />`
    : '';
  return `<svg viewBox="0 0 560 340" role="img" aria-label="${model.family} consultation schematic">
    <rect x="${model.body.x}" y="${model.body.y}" width="${model.body.width}" height="${model.body.height}" rx="4" />
    ${lines.join('\n')}
    ${slidingCue}
    <text x="40" y="315">${model.labels.join(' · ')}</text>
    <text x="40" y="20">consultation-grade schematic / needs_review</text>
  </svg>`;
}

export function dimensionRows(model) {
  return [
    ['폭(W)', model.dimensions.width, 'mm'],
    ['높이(H)', model.dimensions.height, 'mm'],
    ['깊이(D)', model.dimensions.depth, 'mm'],
    ['슬라이딩 상태', model.sliding.state, model.sliding.reason],
    ['검토 상태', model.reviewStatus, '상담용 초안'],
  ];
}
