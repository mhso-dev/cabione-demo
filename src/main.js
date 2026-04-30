/* ============================================================
   STATE & CONFIG
   ============================================================ */

const MIN_W = 200, MAX_W = 2400, MIN_H = 200, MAX_H = 2400;
const STEP = 10; // snapping step in mm

// Templates: existing factory drawings. Customer can edit array to match real catalog.
const TEMPLATES = [
  {
    code: 'BMC-A1',
    name: '기본형 거울장',
    defaultW: 600, defaultH: 700,
    description: '단일 도어 + 내부 선반 1단',
    internals: [
      { type: 'horizontal', mode: 'percent', value: 0.5 } // shelf at 50%
    ]
  },
  {
    code: 'BMC-B1',
    name: '슬라이딩 거울장',
    defaultW: 800, defaultH: 700,
    description: '슬라이딩 도어 2분할',
    internals: [
      { type: 'vertical', mode: 'percent', value: 0.5 }
    ]
  },
  {
    code: 'BMC-C1',
    name: '오픈형 거울장',
    defaultW: 700, defaultH: 800,
    description: '상단 거울 + 하단 수납',
    internals: [
      { type: 'horizontal', mode: 'fixed-from-top', value: 250 }
    ]
  },
  {
    code: 'BLC-D1',
    name: '하부장 (세면대)',
    defaultW: 900, defaultH: 500,
    description: '세면대 하부 수납장',
    internals: [
      { type: 'vertical', mode: 'percent', value: 0.5 },
      { type: 'horizontal', mode: 'percent', value: 0.5 }
    ]
  },
  {
    code: 'BTC-E1',
    name: '키큰장 (사이드)',
    defaultW: 400, defaultH: 1800,
    description: '슬림형 키큰 수납장',
    internals: [
      { type: 'horizontal', mode: 'percent', value: 0.33 },
      { type: 'horizontal', mode: 'percent', value: 0.66 }
    ]
  },
  {
    code: 'BMC-F1',
    name: '와이드 거울장',
    defaultW: 1200, defaultH: 700,
    description: '3분할 와이드 거울장',
    internals: [
      { type: 'vertical', mode: 'percent', value: 1/3 },
      { type: 'vertical', mode: 'percent', value: 2/3 }
    ]
  }
];

// Option definitions: default size, min size, etc. (units in mm)
const OPT_DEFS = {
  shelf:    { name: '선반',       w: 0,   h: 18,  resizable: true,  minW: 100 }, // w=0 means fill cabinet inner width by default
  guidebar: { name: '가이드바',    w: 200, h: 25,  resizable: false },
  outlet1:  { name: '1구 콘센트',  w: 80,  h: 80,  resizable: false },
  outlet2:  { name: '2구 콘센트',  w: 130, h: 80,  resizable: false }
};

const LED_NAMES = {
  warm: '전구색 (3000K)',
  neutral: '주백색 (4000K)',
  day: '주광색 (6500K)'
};

const state = {
  screen: 'home',
  mode: null, // 'template' | 'custom'
  template: null,
  cabinetW: 600,
  cabinetH: 700,
  items: [],
  led: null,
  selectedId: null,
  itemCounter: 0,
  // editor view transform (computed each render)
  scale: 1,
  vbX: 0, vbY: 0, vbW: 0, vbH: 0,
  // drag state
  drag: null, // { id, mode: 'move'|'resize-l'|'resize-r'|'corner', startX, startY, origItem }
  // canvas resize (for custom mode root rect)
  cabinetDrag: null
};

/* ============================================================
   ENTRY / NAV
   ============================================================ */

const screens = {
  home: document.getElementById('home-screen'),
  template: document.getElementById('template-screen'),
  editor: document.getElementById('editor-screen')
};

function showScreen(name) {
  Object.values(screens).forEach(el => el.classList.remove('active'));
  screens[name].classList.add('active');
  state.screen = name;
  if (name === 'editor') {
    // wait a frame for layout, then render
    requestAnimationFrame(() => {
      requestAnimationFrame(render);
    });
  }
}

document.querySelectorAll('[data-action]').forEach(btn => {
  btn.addEventListener('click', () => {
    const act = btn.dataset.action;
    if (act === 'template') {
      buildTemplateGrid();
      showScreen('template');
    } else if (act === 'custom') {
      enterEditor({ custom: true });
    }
  });
});

document.querySelectorAll('[data-back]').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.back;
    if (target === 'home') {
      showScreen('home');
    } else if (target === 'auto') {
      // From editor: go back to template if was template mode, else home
      if (state.mode === 'template') {
        showScreen('template');
      } else {
        showScreen('home');
      }
    }
  });
});

/* ============================================================
   TEMPLATE GRID
   ============================================================ */

function buildTemplateGrid() {
  const grid = document.getElementById('template-grid');
  grid.innerHTML = '';
  TEMPLATES.forEach(tpl => {
    const card = document.createElement('div');
    card.className = 'template-card';
    card.innerHTML = `
      <div class="template-thumb">${renderTemplateThumb(tpl)}</div>
      <div class="template-info">
        <div class="code">${tpl.code}</div>
        <div class="name">${tpl.name}</div>
        <div class="dim">${tpl.defaultW} × ${tpl.defaultH} mm · ${tpl.description}</div>
      </div>
    `;
    card.addEventListener('click', () => {
      enterEditor({ template: tpl });
    });
    grid.appendChild(card);
  });
}

function renderTemplateThumb(tpl) {
  const w = tpl.defaultW, h = tpl.defaultH;
  // fit into 200 x 150 viewBox with padding
  const pad = 30;
  const aspect = w / h;
  const boxW = 220, boxH = 165;
  let dw, dh;
  if (aspect > (boxW - pad*2)/(boxH - pad*2)) {
    dw = boxW - pad*2;
    dh = dw / aspect;
  } else {
    dh = boxH - pad*2;
    dw = dh * aspect;
  }
  const x = (boxW - dw)/2, y = (boxH - dh)/2;

  let internals = '';
  for (const ln of tpl.internals) {
    if (ln.type === 'horizontal') {
      const yy = y + (ln.mode === 'percent' ? dh * ln.value : (ln.mode === 'fixed-from-top' ? (ln.value / h) * dh : dh - (ln.value / h) * dh));
      internals += `<line x1="${x}" y1="${yy}" x2="${x+dw}" y2="${yy}" stroke="#807d77" stroke-width="0.7" stroke-dasharray="3 2"/>`;
    } else {
      const xx = x + (ln.mode === 'percent' ? dw * ln.value : (ln.value / w) * dw);
      internals += `<line x1="${xx}" y1="${y}" x2="${xx}" y2="${y+dh}" stroke="#807d77" stroke-width="0.7" stroke-dasharray="3 2"/>`;
    }
  }

  return `<svg viewBox="0 0 ${boxW} ${boxH}" preserveAspectRatio="xMidYMid meet">
    <rect x="${x}" y="${y}" width="${dw}" height="${dh}" fill="#fbfaf6" stroke="#1a1815" stroke-width="1.5"/>
    ${internals}
    <text x="${x + dw/2}" y="${y - 8}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="8" fill="#807d77">${w}</text>
    <text x="${x - 8}" y="${y + dh/2}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="8" fill="#807d77" transform="rotate(-90 ${x-8} ${y+dh/2})">${h}</text>
  </svg>`;
}

/* ============================================================
   ENTER EDITOR
   ============================================================ */

function enterEditor({ template } = {}) {
  state.items = [];
  state.led = null;
  state.selectedId = null;
  state.itemCounter = 0;

  if (template) {
    state.mode = 'template';
    state.template = template;
    state.cabinetW = template.defaultW;
    state.cabinetH = template.defaultH;
    document.getElementById('ed-pname').textContent = template.name;
    document.getElementById('ed-pcode').textContent = template.code;
    document.getElementById('wm-code').textContent = template.code;
  } else {
    state.mode = 'custom';
    state.template = null;
    state.cabinetW = 600;
    state.cabinetH = 600;
    document.getElementById('ed-pname').textContent = '직접 그리기';
    document.getElementById('ed-pcode').textContent = 'CUSTOM';
    document.getElementById('wm-code').textContent = 'CUSTOM';
  }

  document.getElementById('in-width').value = state.cabinetW;
  document.getElementById('in-height').value = state.cabinetH;
  refreshLEDPills();
  refreshPlacedList();
  showScreen('editor');
}

/* ============================================================
   DIMENSION INPUT
   ============================================================ */

document.getElementById('in-width').addEventListener('input', e => {
  let v = parseInt(e.target.value) || 0;
  if (v < MIN_W) return; // allow user to keep typing
  state.cabinetW = clamp(v, MIN_W, MAX_W);
  clampAllItems();
  render();
});
document.getElementById('in-height').addEventListener('input', e => {
  let v = parseInt(e.target.value) || 0;
  if (v < MIN_H) return;
  state.cabinetH = clamp(v, MIN_H, MAX_H);
  clampAllItems();
  render();
});
document.getElementById('in-width').addEventListener('blur', e => {
  state.cabinetW = clamp(parseInt(e.target.value)||MIN_W, MIN_W, MAX_W);
  e.target.value = state.cabinetW;
  clampAllItems();
  render();
});
document.getElementById('in-height').addEventListener('blur', e => {
  state.cabinetH = clamp(parseInt(e.target.value)||MIN_H, MIN_H, MAX_H);
  e.target.value = state.cabinetH;
  clampAllItems();
  render();
});

/* ============================================================
   ADD OPTIONS
   ============================================================ */

document.querySelectorAll('[data-add]').forEach(btn => {
  btn.addEventListener('click', () => {
    addItem(btn.dataset.add);
  });
});

function addItem(type) {
  const def = OPT_DEFS[type];
  state.itemCounter++;
  const id = 'i' + state.itemCounter;

  let w = def.w || (state.cabinetW * 0.8);
  let h = def.h;

  // if shelf, fill 80% of cabinet width by default and place near top
  if (type === 'shelf') {
    w = Math.min(state.cabinetW - 40, state.cabinetW * 0.85);
    w = Math.round(w / STEP) * STEP;
  }

  // place near center, slightly offset by item count to avoid stacking
  const offset = ((state.items.length) % 4) * 30;
  const x = clamp(Math.round((state.cabinetW - w)/2/STEP)*STEP, 0, state.cabinetW - w);
  let y = clamp(Math.round((state.cabinetH/3 + offset)/STEP)*STEP, 0, state.cabinetH - h);
  if (type === 'shelf') {
    y = clamp(Math.round((state.cabinetH * 0.4 + offset)/STEP)*STEP, 0, state.cabinetH - h);
  }

  state.items.push({ id, type, x, y, w, h });
  state.selectedId = id;
  refreshPlacedList();
  render();
  // open panel might be open on mobile, leave it
}

function refreshPlacedList() {
  const wrap = document.getElementById('placed-list');
  if (state.items.length === 0) {
    wrap.innerHTML = '<div class="empty-hint">아직 추가된 옵션이 없습니다.</div>';
    return;
  }
  wrap.innerHTML = '';
  state.items.forEach(it => {
    const def = OPT_DEFS[it.type];
    const el = document.createElement('div');
    el.className = 'placed-item' + (it.id === state.selectedId ? ' selected' : '');
    el.innerHTML = `
      <span class="pi-name">${def.name}</span>
      <span class="pi-coords">${Math.round(it.x)},${Math.round(it.y)}</span>
      <button class="pi-del" data-del="${it.id}" aria-label="삭제">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3L3 9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
      </button>
    `;
    el.addEventListener('click', e => {
      if (e.target.closest('[data-del]')) return;
      state.selectedId = it.id;
      refreshPlacedList();
      render();
    });
    wrap.appendChild(el);
  });
  wrap.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.del;
      state.items = state.items.filter(x => x.id !== id);
      if (state.selectedId === id) state.selectedId = null;
      refreshPlacedList();
      render();
    });
  });
}

/* ============================================================
   LED
   ============================================================ */

document.querySelectorAll('.led-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    const v = pill.dataset.led;
    state.led = (state.led === v) ? null : v;
    refreshLEDPills();
    render();
  });
});

function refreshLEDPills() {
  document.querySelectorAll('.led-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.led === state.led);
  });
}

/* ============================================================
   HELPERS
   ============================================================ */

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function snapStep(v) { return Math.round(v / STEP) * STEP; }

function clampItem(item) {
  item.w = clamp(item.w, OPT_DEFS[item.type].minW || 20, state.cabinetW);
  item.h = clamp(item.h, 1, state.cabinetH);
  item.x = clamp(item.x, 0, state.cabinetW - item.w);
  item.y = clamp(item.y, 0, state.cabinetH - item.h);
}
function clampAllItems() {
  state.items.forEach(clampItem);
}

/* ============================================================
   RENDERING
   ============================================================ */

const svg = document.getElementById('canvas');
svg.addEventListener('pointerdown', svgEmptyDown);

// margins around cabinet within viewBox (in mm) for dimensions and labels
const PAD_TOP = 100, PAD_BOTTOM = 80, PAD_LEFT = 100, PAD_RIGHT = 80;

function render() {
  if (state.screen !== 'editor') return;
  const host = document.querySelector('.canvas-host');
  const hostW = host.clientWidth;
  const hostH = host.clientHeight;
  if (hostW === 0 || hostH === 0) return;

  // viewBox in "mm" units, with padding on all sides
  const vbW = state.cabinetW + PAD_LEFT + PAD_RIGHT;
  const vbH = state.cabinetH + PAD_TOP + PAD_BOTTOM;
  // scale so that vbW fits hostW and vbH fits hostH
  const sx = hostW / vbW, sy = hostH / vbH;
  const scale = Math.min(sx, sy);
  // viewBox so cabinet origin (0,0) maps to (PAD_LEFT, PAD_TOP) in vb space
  const vbX = -PAD_LEFT;
  const vbY = -PAD_TOP;

  state.scale = scale;
  state.vbX = vbX; state.vbY = vbY; state.vbW = vbW; state.vbH = vbH;

  // Display the viewbox in the dom: width/height = pixel size we want; viewBox = mm coords
  // We center within hostW/hostH:
  const drawW = vbW * scale;
  const drawH = vbH * scale;
  svg.setAttribute('width', drawW);
  svg.setAttribute('height', drawH);
  svg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
  svg.style.position = 'absolute';
  svg.style.left = ((hostW - drawW)/2) + 'px';
  svg.style.top = ((hostH - drawH)/2) + 'px';

  // Update toolbar
  // approximate scale ratio: 1mm displays as scale px, so scale = X means pixel/mm
  // "scale 1:N" means 1 unit drawing = N units real. Here we show ratio so that real-world mm vs displayed mm is informative
  // But more useful for user: show pixels-per-mm? Actually let's show e.g. "1 : 5" meaning 1 mm display = 5 mm real.
  const pxPerMm = scale;
  // Standard CAD: scale 1:N -> if display has Y mm per real X mm, ratio is X:Y. Most apps show scale as number e.g. 1:10
  // We'll show ratio rounded
  const ratio = Math.round(1 / pxPerMm * 3.78); // 3.78 px per mm at 96dpi
  document.getElementById('tb-scale').textContent = ratio > 0 ? ratio : 1;

  // Build SVG
  let parts = [];

  // Background grid (every 50 mm)
  parts.push(buildGrid());

  // Cabinet frame
  parts.push(`<rect class="cabinet-rect" x="0" y="0" width="${state.cabinetW}" height="${state.cabinetH}"/>`);

  // Internal template lines
  if (state.mode === 'template' && state.template) {
    for (const ln of state.template.internals) {
      if (ln.type === 'horizontal') {
        let y;
        if (ln.mode === 'percent') y = state.cabinetH * ln.value;
        else if (ln.mode === 'fixed-from-top') y = Math.min(ln.value, state.cabinetH);
        else y = state.cabinetH - Math.min(ln.value, state.cabinetH);
        parts.push(`<line class="internal-line" x1="0" y1="${y}" x2="${state.cabinetW}" y2="${y}"/>`);
      } else {
        let x;
        if (ln.mode === 'percent') x = state.cabinetW * ln.value;
        else x = Math.min(ln.value, state.cabinetW);
        parts.push(`<line class="internal-line" x1="${x}" y1="0" x2="${x}" y2="${state.cabinetH}"/>`);
      }
    }
  }

  // Items
  for (const item of state.items) {
    parts.push(buildItem(item, item.id === state.selectedId));
  }

  // LED indicator
  if (state.led) {
    parts.push(buildLEDIndicator(state.led));
  }

  // Outer dimensions (always)
  parts.push(buildOuterDims());

  // Custom mode: corner handles for resizing cabinet itself
  if (state.mode === 'custom') {
    parts.push(buildCornerHandles());
  }

  // Selected item: live dimensions to edges
  if (state.selectedId) {
    const item = state.items.find(i => i.id === state.selectedId);
    if (item) parts.push(buildItemDims(item));
  }

  svg.innerHTML = parts.join('');

  // Attach drag handlers to items
  state.items.forEach(it => {
    const el = svg.querySelector(`[data-item="${it.id}"]`);
    if (el) attachItemPointer(el, it.id);
  });
  // Resize handles for shelves
  svg.querySelectorAll('[data-handle]').forEach(h => {
    attachHandlePointer(h);
  });
  // Custom corner handles
  if (state.mode === 'custom') {
    svg.querySelectorAll('[data-corner]').forEach(h => attachCornerPointer(h));
  }

}

function buildGrid() {
  const w = state.cabinetW, h = state.cabinetH;
  const step = 50;
  let gridLines = '';
  let strongLines = '';
  // horizontal lines (extending across full vb width including pads)
  const minX = state.vbX, maxX = state.vbX + state.vbW;
  const minY = state.vbY, maxY = state.vbY + state.vbH;
  // vertical
  const startX = Math.floor(minX / step) * step;
  for (let x = startX; x <= maxX; x += step) {
    if (x === 0 || x === w) {
      strongLines += `<line x1="${x}" y1="${minY}" x2="${x}" y2="${maxY}"/>`;
    } else {
      gridLines += `<line x1="${x}" y1="${minY}" x2="${x}" y2="${maxY}"/>`;
    }
  }
  const startY = Math.floor(minY / step) * step;
  for (let y = startY; y <= maxY; y += step) {
    if (y === 0 || y === h) {
      strongLines += `<line x1="${minX}" y1="${y}" x2="${maxX}" y2="${y}"/>`;
    } else {
      gridLines += `<line x1="${minX}" y1="${y}" x2="${maxX}" y2="${y}"/>`;
    }
  }
  return `<g class="svg-grid">${gridLines}</g><g class="svg-grid-strong">${strongLines}</g>`;
}

function buildItem(item, selected) {
  const def = OPT_DEFS[item.type];
  const cls = `item item-${item.type === 'outlet1' || item.type === 'outlet2' ? 'outlet' : item.type}` + (selected ? ' selected' : '');

  if (item.type === 'shelf') {
    let extra = '';
    if (selected && def.resizable) {
      const hs = 8;
      extra += `<rect class="handle" data-handle="resize-l" data-id="${item.id}" x="${item.x - hs/2}" y="${item.y + item.h/2 - hs/2}" width="${hs}" height="${hs}" rx="1.5"/>`;
      extra += `<rect class="handle" data-handle="resize-r" data-id="${item.id}" x="${item.x + item.w - hs/2}" y="${item.y + item.h/2 - hs/2}" width="${hs}" height="${hs}" rx="1.5"/>`;
    }
    return `<g class="${cls}" data-item="${item.id}">
      <rect x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" rx="1"/>
      ${extra}
    </g>`;
  }
  if (item.type === 'guidebar') {
    return `<g class="${cls}" data-item="${item.id}">
      <rect x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" rx="2"/>
      <circle cx="${item.x + 8}" cy="${item.y + item.h/2}" r="3" fill="#fbfaf6"/>
      <circle cx="${item.x + item.w - 8}" cy="${item.y + item.h/2}" r="3" fill="#fbfaf6"/>
    </g>`;
  }
  if (item.type === 'outlet1') {
    return `<g class="${cls}" data-item="${item.id}">
      <rect x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" rx="2"/>
      <circle cx="${item.x + item.w/2}" cy="${item.y + item.h/2}" r="${Math.min(item.w,item.h)*0.18}"/>
      <text x="${item.x + item.w/2}" y="${item.y + item.h - 6}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="9" fill="#1a1815">1구</text>
    </g>`;
  }
  if (item.type === 'outlet2') {
    return `<g class="${cls}" data-item="${item.id}">
      <rect x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" rx="2"/>
      <circle cx="${item.x + item.w*0.3}" cy="${item.y + item.h/2 - 2}" r="${Math.min(item.w,item.h)*0.14}"/>
      <circle cx="${item.x + item.w*0.7}" cy="${item.y + item.h/2 - 2}" r="${Math.min(item.w,item.h)*0.14}"/>
      <text x="${item.x + item.w/2}" y="${item.y + item.h - 6}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="9" fill="#1a1815">2구</text>
    </g>`;
  }
  return '';
}

function buildLEDIndicator(led) {
  // Strip along bottom inside cabinet, with label below
  const stripY = state.cabinetH - 8;
  const labelY = state.cabinetH + 32;
  const colorMap = { warm: '#ff9a3c', neutral: '#ffe9a8', day: '#cfe2ff' };
  const c = colorMap[led];
  const label = LED_NAMES[led];
  return `
    <g class="led-strip-group">
      <rect class="led-strip-bg" x="2" y="${stripY}" width="${state.cabinetW - 4}" height="6" rx="2"/>
      <line x1="6" y1="${stripY+3}" x2="${state.cabinetW-6}" y2="${stripY+3}" stroke="${c}" stroke-width="3" stroke-dasharray="4 3"/>
      <text x="${state.cabinetW/2}" y="${labelY}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="11" fill="#c54a1f" font-weight="600">LED ${label}</text>
    </g>
  `;
}

function buildOuterDims() {
  const w = state.cabinetW, h = state.cabinetH;
  const offTop = 36, offLeft = 36, offBottom = 36;
  const tickLen = 6;

  // Top width dimension
  const topY = -offTop;
  const lWidth = `
    <line class="dim-line" x1="0" y1="${topY}" x2="${w}" y2="${topY}"/>
    <line class="dim-tick" x1="0" y1="${topY-tickLen}" x2="0" y2="${topY+tickLen}"/>
    <line class="dim-tick" x1="${w}" y1="${topY-tickLen}" x2="${w}" y2="${topY+tickLen}"/>
    <line class="dim-line" x1="0" y1="${topY-tickLen-2}" x2="0" y2="-2"/>
    <line class="dim-line" x1="${w}" y1="${topY-tickLen-2}" x2="${w}" y2="-2"/>
    <text class="dim-text" x="${w/2}" y="${topY - 6}" text-anchor="middle">${w}</text>
  `;

  // Left height dimension
  const leftX = -offLeft;
  const lHeight = `
    <line class="dim-line" x1="${leftX}" y1="0" x2="${leftX}" y2="${h}"/>
    <line class="dim-tick" x1="${leftX-tickLen}" y1="0" x2="${leftX+tickLen}" y2="0"/>
    <line class="dim-tick" x1="${leftX-tickLen}" y1="${h}" x2="${leftX+tickLen}" y2="${h}"/>
    <line class="dim-line" x1="${leftX-tickLen-2}" y1="0" x2="-2" y2="0"/>
    <line class="dim-line" x1="${leftX-tickLen-2}" y1="${h}" x2="-2" y2="${h}"/>
    <text class="dim-text" x="${leftX - 8}" y="${h/2}" text-anchor="middle" transform="rotate(-90 ${leftX-8} ${h/2})">${h}</text>
  `;

  return lWidth + lHeight;
}

function buildItemDims(item) {
  // Dimensions from item to nearest edges (left/right horizontal, top/bottom vertical)
  // Plus item own dimensions (w x h shown next to item)
  const w = state.cabinetW, h = state.cabinetH;
  const distLeft = item.x;
  const distRight = w - item.x - item.w;
  const distTop = item.y;
  const distBottom = h - item.y - item.h;

  let out = '';
  // Horizontal: along top edge of item
  const yMid = item.y + item.h / 2;
  out += `<line class="dim-line active" x1="0" y1="${yMid}" x2="${item.x}" y2="${yMid}" stroke-dasharray="2 2"/>`;
  out += `<line class="dim-line active" x1="${item.x + item.w}" y1="${yMid}" x2="${w}" y2="${yMid}" stroke-dasharray="2 2"/>`;
  if (distLeft > 30) out += `<text class="dim-text active" x="${item.x/2}" y="${yMid - 6}" text-anchor="middle">${Math.round(distLeft)}</text>`;
  if (distRight > 30) out += `<text class="dim-text active" x="${item.x + item.w + distRight/2}" y="${yMid - 6}" text-anchor="middle">${Math.round(distRight)}</text>`;

  // Vertical: along left edge of item
  const xMid = item.x + item.w / 2;
  out += `<line class="dim-line active" x1="${xMid}" y1="0" x2="${xMid}" y2="${item.y}" stroke-dasharray="2 2"/>`;
  out += `<line class="dim-line active" x1="${xMid}" y1="${item.y + item.h}" x2="${xMid}" y2="${h}" stroke-dasharray="2 2"/>`;
  if (distTop > 30) out += `<text class="dim-text active" x="${xMid + 6}" y="${item.y/2 + 4}" text-anchor="start">${Math.round(distTop)}</text>`;
  if (distBottom > 30) out += `<text class="dim-text active" x="${xMid + 6}" y="${item.y + item.h + distBottom/2 + 4}" text-anchor="start">${Math.round(distBottom)}</text>`;

  // Item own size label
  if (item.type === 'shelf') {
    out += `<text class="dim-text active" x="${xMid}" y="${item.y - 6}" text-anchor="middle" font-weight="600">${Math.round(item.w)} × ${Math.round(item.h)}</text>`;
  } else {
    out += `<text class="dim-text active" x="${item.x + item.w + 6}" y="${item.y + item.h + 12}" font-weight="600">${Math.round(item.w)}×${Math.round(item.h)}</text>`;
  }

  return out;
}

function buildCornerHandles() {
  // four corners of the cabinet for resizing in custom mode
  const hs = 12;
  const corners = [
    { id: 'tl', x: 0, y: 0 },
    { id: 'tr', x: state.cabinetW, y: 0 },
    { id: 'bl', x: 0, y: state.cabinetH },
    { id: 'br', x: state.cabinetW, y: state.cabinetH }
  ];
  return corners.map(c => `<rect class="corner-handle" data-corner="${c.id}" x="${c.x - hs/2}" y="${c.y - hs/2}" width="${hs}" height="${hs}" rx="2"/>`).join('');
}

/* ============================================================
   POINTER EVENTS
   ============================================================ */

function svgClientToMM(clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  // Scale: viewBox vbW maps to rect.width
  const mmX = state.vbX + (clientX - rect.left) * (state.vbW / rect.width);
  const mmY = state.vbY + (clientY - rect.top) * (state.vbH / rect.height);
  return { x: mmX, y: mmY };
}

function svgEmptyDown(e) {
  // If clicked on item or handle, ignore
  if (e.target.closest('[data-item]') || e.target.closest('[data-handle]') || e.target.closest('[data-corner]')) return;
  state.selectedId = null;
  refreshPlacedList();
  render();
}

function attachItemPointer(el, id) {
  el.style.cursor = 'move';
  el.addEventListener('pointerdown', e => {
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    const item = state.items.find(x => x.id === id);
    if (!item) return;
    state.selectedId = id;
    const start = svgClientToMM(e.clientX, e.clientY);
    state.drag = {
      id, mode: 'move',
      startX: start.x, startY: start.y,
      origX: item.x, origY: item.y
    };
    refreshPlacedList();
    render();
    // re-attach since DOM rebuilt
    rebindAfterRender(el, id);
  });
}

function rebindAfterRender(_oldEl, id) {
  // After render(), DOM nodes were replaced. We need the new element to receive pointer events.
  // We use document-level move/up to keep tracking.
  const onMove = e => {
    if (!state.drag) return;
    const cur = svgClientToMM(e.clientX, e.clientY);
    const item = state.items.find(x => x.id === state.drag.id);
    if (!item) return;

    if (state.drag.mode === 'move') {
      let nx = state.drag.origX + (cur.x - state.drag.startX);
      let ny = state.drag.origY + (cur.y - state.drag.startY);
      nx = snapStep(nx);
      ny = snapStep(ny);
      nx = clamp(nx, 0, state.cabinetW - item.w);
      ny = clamp(ny, 0, state.cabinetH - item.h);
      item.x = nx;
      item.y = ny;
    } else if (state.drag.mode === 'resize-l') {
      const dx = cur.x - state.drag.startX;
      let newX = state.drag.origX + dx;
      let newW = state.drag.origW - dx;
      newX = snapStep(newX);
      newW = state.drag.origX + state.drag.origW - newX;
      const minW = OPT_DEFS[item.type].minW || 50;
      if (newW < minW) {
        newW = minW;
        newX = state.drag.origX + state.drag.origW - newW;
      }
      if (newX < 0) {
        newW = newW + newX;
        newX = 0;
      }
      item.x = newX; item.w = newW;
    } else if (state.drag.mode === 'resize-r') {
      const dx = cur.x - state.drag.startX;
      let newW = state.drag.origW + dx;
      newW = snapStep(newW);
      const minW = OPT_DEFS[item.type].minW || 50;
      if (newW < minW) newW = minW;
      if (item.x + newW > state.cabinetW) newW = state.cabinetW - item.x;
      item.w = newW;
    }
    render();
  };
  const onUp = e => {
    if (state.drag) {
      const item = state.items.find(x => x.id === state.drag.id);
      if (item) clampItem(item);
    }
    state.drag = null;
    refreshPlacedList();
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    render();
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}

function attachHandlePointer(el) {
  el.addEventListener('pointerdown', e => {
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    const id = el.dataset.id;
    const mode = el.dataset.handle;
    const item = state.items.find(x => x.id === id);
    if (!item) return;
    state.selectedId = id;
    const start = svgClientToMM(e.clientX, e.clientY);
    state.drag = {
      id, mode,
      startX: start.x, startY: start.y,
      origX: item.x, origY: item.y,
      origW: item.w, origH: item.h
    };
    rebindAfterRender(el, id);
  });
}

function attachCornerPointer(el) {
  el.addEventListener('pointerdown', e => {
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    const corner = el.dataset.corner;
    const start = svgClientToMM(e.clientX, e.clientY);
    state.cabinetDrag = {
      corner,
      startX: start.x, startY: start.y,
      origW: state.cabinetW, origH: state.cabinetH
    };
    const onMove = ev => {
      if (!state.cabinetDrag) return;
      const cur = svgClientToMM(ev.clientX, ev.clientY);
      const dx = cur.x - state.cabinetDrag.startX;
      const dy = cur.y - state.cabinetDrag.startY;
      let nW = state.cabinetDrag.origW;
      let nH = state.cabinetDrag.origH;
      if (corner === 'br' || corner === 'tr') nW = state.cabinetDrag.origW + dx;
      if (corner === 'bl' || corner === 'tl') nW = state.cabinetDrag.origW - dx;
      if (corner === 'br' || corner === 'bl') nH = state.cabinetDrag.origH + dy;
      if (corner === 'tr' || corner === 'tl') nH = state.cabinetDrag.origH - dy;
      nW = snapStep(clamp(nW, MIN_W, MAX_W));
      nH = snapStep(clamp(nH, MIN_H, MAX_H));
      state.cabinetW = nW;
      state.cabinetH = nH;
      document.getElementById('in-width').value = nW;
      document.getElementById('in-height').value = nH;
      clampAllItems();
      render();
    };
    const onUp = () => {
      state.cabinetDrag = null;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  });
}

/* ============================================================
   MOBILE PANEL TOGGLE & FIT
   ============================================================ */

document.getElementById('panel-toggle').addEventListener('click', () => {
  document.getElementById('left-panel').classList.toggle('open');
});

// click outside panel on mobile to close
document.addEventListener('click', e => {
  if (window.innerWidth > 768) return;
  const panel = document.getElementById('left-panel');
  if (!panel.classList.contains('open')) return;
  if (e.target.closest('#left-panel') || e.target.closest('#panel-toggle')) return;
  panel.classList.remove('open');
});

document.getElementById('btn-fit').addEventListener('click', () => {
  render();
});

window.addEventListener('resize', () => {
  if (state.screen === 'editor') render();
});

/* ============================================================
   SUMMARY / ORDER
   ============================================================ */

document.getElementById('btn-summary').addEventListener('click', () => {
  const body = document.getElementById('summary-body');
  const lines = [];
  lines.push(`<div class="summary-grp">
    <h5>Product</h5>
    <div class="summary-row"><span class="lbl">제품명</span><span class="val">${state.template ? state.template.name : '직접 그리기 (Custom)'}</span></div>
    <div class="summary-row"><span class="lbl">제품코드</span><span class="val">${state.template ? state.template.code : 'CUSTOM'}</span></div>
    <div class="summary-row"><span class="lbl">치수 (W × H)</span><span class="val">${state.cabinetW} × ${state.cabinetH} mm</span></div>
  </div>`);

  if (state.items.length) {
    lines.push(`<div class="summary-grp"><h5>Options</h5>`);
    state.items.forEach((it, idx) => {
      const def = OPT_DEFS[it.type];
      const sizeStr = it.type === 'shelf' ? `${Math.round(it.w)} mm` : `${Math.round(it.w)} × ${Math.round(it.h)} mm`;
      lines.push(`<div class="summary-row">
        <span class="lbl">${idx+1}. ${def.name}</span>
        <span class="val">위치 (${Math.round(it.x)}, ${Math.round(it.y)}) · 크기 ${sizeStr}</span>
      </div>`);
    });
    lines.push(`</div>`);
  }

  if (state.led) {
    lines.push(`<div class="summary-grp">
      <h5>LED</h5>
      <div class="summary-row"><span class="lbl">색온도</span><span class="val">${LED_NAMES[state.led]}</span></div>
    </div>`);
  }

  body.innerHTML = lines.join('');
  openSummaryModal();
});

function openSummaryModal() {
  document.getElementById('summary-modal').classList.add('active');
}

function closeSummaryModal() {
  document.getElementById('summary-modal').classList.remove('active');
}

document.getElementById('modal-close').addEventListener('click', closeSummaryModal);

document.getElementById('summary-modal').addEventListener('click', e => {
  if (e.target.id === 'summary-modal') {
    closeSummaryModal();
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeSummaryModal();
});

document.getElementById('btn-copy').addEventListener('click', async () => {
  let txt = '[비규격 발주서]\n';
  txt += `제품: ${state.template ? state.template.name + ' (' + state.template.code + ')' : '직접 그리기 (CUSTOM)'}\n`;
  txt += `치수: ${state.cabinetW} × ${state.cabinetH} mm\n`;
  if (state.items.length) {
    txt += `\n[옵션]\n`;
    state.items.forEach((it, idx) => {
      const def = OPT_DEFS[it.type];
      const sizeStr = it.type === 'shelf' ? `${Math.round(it.w)}mm` : `${Math.round(it.w)}×${Math.round(it.h)}mm`;
      txt += `${idx+1}. ${def.name} - 위치(${Math.round(it.x)},${Math.round(it.y)}), 크기 ${sizeStr}\n`;
    });
  }
  if (state.led) txt += `\nLED: ${LED_NAMES[state.led]}\n`;
  await copyText(txt);
  const btn = document.getElementById('btn-copy');
  const old = btn.textContent;
  btn.textContent = '복사됨 ✓';
  setTimeout(() => { btn.textContent = old; }, 1400);
});

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (_error) {
      // Fall back for non-secure contexts or denied clipboard permissions.
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

document.getElementById('btn-print').addEventListener('click', () => {
  window.print();
});

/* ============================================================
   PRINT CSS (inline)
   ============================================================ */
const printStyle = document.createElement('style');
printStyle.textContent = `
@media print {
  html, body { overflow: visible !important; height: auto !important; background: white; }
  .panel-foot, .panel, .top-bar, .canvas-toolbar, .home-shell, .modal-foot, .modal-head .modal-close, .panel-toggle, .canvas-watermark { display: none !important; }
  .modal-backdrop { position: static !important; background: transparent !important; backdrop-filter: none !important; padding: 0 !important; }
  .modal { max-width: none !important; max-height: none !important; box-shadow: none !important; }
}
`;
document.head.appendChild(printStyle);

/* ============================================================
   INIT
   ============================================================ */
showScreen('home');
