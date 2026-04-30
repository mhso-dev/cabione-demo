export function renderSvg(model) {
  const { scale } = model.viewport;
  const ox = 60;
  const oy = 40;
  const body = model.components.map((component) => {
    const x = ox + component.x * scale;
    const y = oy + component.y * scale;
    const width = Math.max(1, component.width * scale);
    const height = Math.max(1, component.height * scale);
    const cls = `component ${component.kind}`;
    return `<rect class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" rx="2"><title>${component.id}</title></rect>`;
  }).join('\n');
  const openingLines = (model.doorOpeningLines ?? []).map((line) => {
    const x1 = ox + line.x1 * scale;
    const y1 = oy + line.y1 * scale;
    const x2 = ox + line.x2 * scale;
    const y2 = oy + line.y2 * scale;
    const cls = `door-opening-line ${line.lineStyle === 'dashed' ? 'dashed' : 'solid'}`;
    const title = `${line.componentId} 문 열림 방향 · 경첩 ${line.hinge}`;
    return `<line class="${cls}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"><title>${title}</title></line>`;
  }).join('\n');
  const hinges = (model.hingeMarkers ?? []).map((hinge) => {
    const x = ox + hinge.x * scale;
    const y = oy + hinge.y * scale;
    const labelOffset = hinge.side === 'left' ? -46 : 12;
    const labelX = hinge.side === 'top' ? x - 16 : x + labelOffset;
    const labelY = hinge.side === 'top' ? y - 10 : y - 8;
    return `<g class="hinge-marker">
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6"><title>${hinge.componentId} ${hinge.side} 경첩 위치</title></circle>
      <text x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}">경첩</text>
    </g>`;
  }).join('\n');
  const w = model.dimensions.width;
  const h = model.dimensions.height;
  const frontW = w * scale;
  const frontH = h * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${model.viewport.width} ${model.viewport.height}" role="img" aria-label="상담용 2D 도식">
    <defs><style>.component{fill:#f8fafc;stroke:#334155;stroke-width:2}.door,.flap{fill:#dbeafe}.sliding-panel{fill:#ccfbf1;fill-opacity:.78}.leg{fill:#94a3b8}.door-opening-line{stroke:#64748b;stroke-width:2.2;fill:none;stroke-linecap:round}.door-opening-line.dashed{stroke-dasharray:14 10}.door-opening-line.solid{stroke-opacity:.9}.hinge-marker circle{fill:#fee2e2;stroke:#dc2626;stroke-width:2}.hinge-marker text{font:11px system-ui,sans-serif;fill:#b91c1c}.dim{stroke:#ef4444;stroke-width:1.5;marker-end:url(#a);marker-start:url(#a)}text{font:14px system-ui,sans-serif;fill:#111827}.watermark{font-size:12px;fill:#64748b}</style><marker id="a" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#ef4444"/></marker></defs>
    <text x="20" y="24">${model.familyDisplayName} · ${model.templateId ?? ''}</text>
    ${body}
    ${openingLines}
    ${hinges}
    <line class="dim" x1="${ox}" y1="${oy + frontH + 24}" x2="${ox + frontW}" y2="${oy + frontH + 24}"/>
    <text x="${ox + frontW / 2 - 45}" y="${oy + frontH + 48}">폭 ${w} mm</text>
    <line class="dim" x1="${ox + frontW + 24}" y1="${oy}" x2="${ox + frontW + 24}" y2="${oy + frontH}"/>
    <text x="${ox + frontW + 34}" y="${oy + frontH / 2}">높이 ${h} mm</text>
    <text class="watermark" x="20" y="${model.viewport.height - 18}">상담용 2D 도식 · production CAD 아님 · constraints 검토 필요</text>
  </svg>`;
}
