export function renderDimensionTable(model) {
  const labelMap = { W: '폭', H: '높이', D: '깊이', Width: '폭', Height: '높이', Depth: '깊이' };
  const statusMap = { needs_review: '검토 필요', accepted: '확인됨', blocker: '차단됨' };
  const rows = model.dimensionTable.map((row) => `<tr><th>${labelMap[row.label] ?? row.label}</th><td>${row.value}</td><td>${row.unit}</td><td>${statusMap[row.reviewStatus] ?? row.reviewStatus}</td></tr>`).join('');
  return `<table class="dimension-table"><thead><tr><th>항목</th><th>값</th><th>단위</th><th>상태</th></tr></thead><tbody>${rows}</tbody></table>`;
}
