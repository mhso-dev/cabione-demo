import templateManifest from './data/templateManifest.json' with { type: 'json' };
import {
  buildDashboardModel,
  formatAssetSubtitle,
  formatThreadMessages,
  statusLabel,
} from './workflow.js';

/* ============================================================
   STATE & CONFIG
   ============================================================ */

const MIN_W = 200, MAX_W = 2400, MIN_H = 200, MAX_H = 2400;
const STEP = 10; // snapping step in mm

let templateLoadPromise = null;
let dwgSampleTemplates = [];

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

const DEFAULT_FINISH_COLORS = {
  exterior: '#fbfaf6',
  interior: '#f7efe2',
};

const STORAGE_KEY = 'cabione:drawing-assets:v1';
const ROLE_LABELS = {
  sales: '영업 사원',
  admin: '관리자',
};
const REVIEW_STATUS = {
  draft: '작성중',
  in_review: '검토중',
  approved: '승인',
  rejected: '반려',
};
const REVIEW_STATUS_CLASS = {
  draft: 'draft',
  in_review: 'in-review',
  approved: 'approved',
  rejected: 'rejected',
};
const GENERIC_CONSTRAINTS = {
  edgeClearance: 20,
  outletClearance: 40,
  optionGap: 10,
  minLedCabinetHeight: 350,
  ledReservedBottom: 56,
};

const state = {
  screen: 'home',
  mode: null, // 'template' | 'custom'
  template: null,
  cabinetW: 600,
  cabinetH: 700,
  cabinetD: 300,
  items: [],
  led: null,
  finishColors: { ...DEFAULT_FINISH_COLORS },
  hingeConfig: {
    selectedDoor: 1,
    doors: [],
  },
  selectedId: null,
  itemCounter: 0,
  // editor view transform (computed each render)
  scale: 1,
  vbX: 0, vbY: 0, vbW: 0, vbH: 0,
  // drag state
  drag: null, // { id, mode: 'move'|'resize-l'|'resize-r'|'corner', startX, startY, origItem }
  // canvas resize (for custom mode root rect)
  cabinetDrag: null,
  role: 'sales',
  dashboardFilter: 'all',
  assets: loadStoredAssets(),
  currentAssetId: null,
  reviewStatus: 'draft',
  comments: [],
  constraintNotice: '',
};

/* ============================================================
   ENTRY / NAV
   ============================================================ */

const screens = {
  home: document.getElementById('home-screen'),
  template: document.getElementById('template-screen'),
  dashboard: document.getElementById('dashboard-screen'),
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
  } else if (name === 'dashboard') {
    renderDashboard();
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
    } else if (act === 'dashboard') {
      state.role = 'admin';
      state.dashboardFilter = 'all';
      renderDashboard();
      showScreen('dashboard');
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
  grid.innerHTML = '<div class="template-loading">DWG 샘플 템플릿을 불러오는 중입니다.</div>';
  loadDwgSampleTemplates()
    .then(templates => {
      grid.innerHTML = '';
      templates.forEach(tpl => {
        const card = document.createElement('div');
        card.className = 'template-card';
        card.dataset.family = tpl.family;
        card.dataset.templateId = tpl.code;
        card.dataset.legSupport = tpl.legSupportEvidence ? 'true' : 'false';
        card.dataset.legRender = shouldRenderLegSupports(tpl) ? 'true' : 'false';
        card.innerHTML = `
          <div class="template-thumb">${renderTemplateThumb(tpl)}</div>
          <div class="template-info">
            <div class="code">${escapeHtml(tpl.code)}</div>
            <div class="name">${escapeHtml(tpl.name)}</div>
            <div class="template-meta">
              <span>${escapeHtml(tpl.family)}</span>
              <span>${escapeHtml(tpl.reviewStatus)}</span>
              ${shouldRenderLegSupports(tpl) ? `<span>${tpl.legSupportEvidence ? 'DWG 다리감지' : '다리형 초안'}</span>` : ''}
            </div>
            <div class="dim">${escapeHtml(tpl.defaultW)} × ${escapeHtml(tpl.defaultH)} × ${escapeHtml(tpl.defaultD)} mm · ${escapeHtml(tpl.description)}</div>
            <div class="template-evidence">DWG entity ${escapeHtml(tpl.entityCount)} · 치수 ${escapeHtml(tpl.dimensionCount)} · ${escapeHtml(tpl.dwgExtractionStatus)}</div>
          </div>
        `;
        card.addEventListener('click', () => {
          enterEditor({ template: tpl });
        });
        grid.appendChild(card);
      });
    })
    .catch(error => {
      grid.innerHTML = `<div class="template-loading error">DWG 샘플 템플릿을 불러오지 못했습니다: ${escapeHtml(error.message)}</div>`;
    });
}

async function loadDwgSampleTemplates() {
  if (!templateLoadPromise) {
    templateLoadPromise = Promise.all((templateManifest.templates ?? []).map(async entry => {
      const templatePath = `./${entry.path.replace(/^src\//, '')}`;
      const mod = await import(templatePath, { with: { type: 'json' } });
      return normalizeDwgTemplate(entry, mod.default);
    })).then(templates => {
      dwgSampleTemplates = templates;
      return templates;
    });
  }
  return templateLoadPromise;
}

function normalizeDwgTemplate(entry, template) {
  const dimensions = template.defaults?.dimensions ?? {};
  const options = template.defaults?.options ?? {};
  const defaultW = Number(dimensions.width ?? template.constraints?.dimensions?.width?.default ?? 600);
  const defaultH = Number(dimensions.height ?? template.constraints?.dimensions?.height?.default ?? 700);
  const defaultD = Number(dimensions.depth ?? template.constraints?.dimensions?.depth?.default ?? 300);
  const family = template.familyDisplayName ?? entry.familyDisplayName ?? template.family ?? '욕실가구';
  const code = template.templateId ?? entry.templateId;
  return {
    code,
    name: template.displayName ?? entry.displayName ?? code,
    family,
    familyId: template.familyId ?? entry.familyId,
    defaultW,
    defaultH,
    defaultD,
    description: buildTemplateDescription(family, options, template),
    internals: buildTemplateInternals(family, options),
    reviewStatus: template.reviewStatus ?? entry.reviewStatus ?? 'needs_review',
    dwgExtractionStatus: template.dwgExtractionStatus ?? entry.dwgExtractionStatus ?? 'unknown',
    entityCount: entry.entityCount ?? template.sampleReferences?.dwg?.entityCount ?? 0,
    dimensionCount: entry.dimensionCount ?? template.sampleReferences?.dwg?.dimensionCount ?? 0,
    sourceFiles: template.sourceFiles ?? entry.sourceFiles ?? {},
    mountType: options.mountType,
    legSupportEvidence: findProductSignal(template, 'leg_support_geometry')?.value ?? null,
    rawTemplate: template,
  };
}

function buildTemplateDescription(family, options, template) {
  const parts = [family];
  if (Number(options.doorCount) > 0) parts.push(`${options.doorCount}도어`);
  if (Number(options.flapCount) > 0) parts.push(`${options.flapCount}플랩`);
  if (options.sliding) parts.push(`${options.slidingPanelCount ?? 2}분할 슬라이딩`);
  if (options.mountType === 'legged') parts.push('다리형');
  if (options.mountType === 'wall_mounted') parts.push('벽걸이');
  const materialSignals = findProductSignal(template, 'mirror_material_labels')?.value ?? [];
  if (materialSignals.length) parts.push(materialSignals.slice(0, 2).join('/'));
  return parts.join(' · ');
}

function findProductSignal(template, kind) {
  return template.drawingInfo?.productSelectionSignals?.find(signal => signal.kind === kind)
    ?? template.productSelectionSignals?.find(signal => signal.kind === kind);
}

function buildTemplateInternals(family, options) {
  if (family === '슬라이징장') {
    const panels = Number(options.slidingPanelCount || 2);
    return Array.from({ length: Math.max(0, panels - 1) }, (_, index) => ({
      type: 'vertical',
      mode: 'percent',
      value: (index + 1) / panels,
    }));
  }
  const doorCount = Number(options.doorCount || 0);
  if (doorCount > 1) {
    return Array.from({ length: doorCount - 1 }, (_, index) => ({
      type: 'vertical',
      mode: 'percent',
      value: (index + 1) / doorCount,
    }));
  }
  if (Number(options.flapCount || 0) > 1) {
    return [{ type: 'horizontal', mode: 'percent', value: 0.5 }];
  }
  if (family === '하부장' || family === '상부장') {
    return [{ type: 'horizontal', mode: 'percent', value: 0.5 }];
  }
  return [];
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function loadStoredAssets() {
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isStoredAsset) : [];
  } catch (_error) {
    return [];
  }
}

function isStoredAsset(asset) {
  return Boolean(asset?.id && asset?.drawing?.dimensions && REVIEW_STATUS[asset.reviewStatus ?? 'draft']);
}

function persistAssetsLocal() {
  try {
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state.assets));
  } catch (_error) {
    state.constraintNotice = '브라우저 임시 저장소를 사용할 수 없어 현재 화면에만 도면이 유지됩니다.';
  }
}

function upsertAsset(asset) {
  const index = state.assets.findIndex(item => item.id === asset.id);
  if (index >= 0) state.assets[index] = asset;
  else state.assets.unshift(asset);
  state.currentAssetId = asset.id;
  state.reviewStatus = asset.reviewStatus;
  state.comments = asset.comments ?? [];
  persistAssetsLocal();
  return asset;
}

function syncWorkflowSurfaces() {
  if (state.screen === 'editor') syncWorkflowPanel();
  if (state.screen === 'dashboard') renderDashboard();
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

async function hydrateAssets() {
  try {
    const payload = await requestJson('/api/assets');
    state.assets = Array.isArray(payload.assets) ? payload.assets.filter(isStoredAsset) : [];
    persistAssetsLocal();
    syncWorkflowSurfaces();
  } catch (_error) {
    state.constraintNotice = '서버 저장소에 연결할 수 없어 브라우저 임시 저장소를 사용합니다.';
    syncWorkflowSurfaces();
  }
}

function nowIso() {
  return new Date().toISOString();
}

function makeAssetId() {
  return `drawing-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function formatShortTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function activeAsset() {
  return state.assets.find(asset => asset.id === state.currentAssetId) ?? null;
}

function activeDrawingChanged(asset = activeAsset()) {
  if (!asset) return false;
  const titleInput = document.getElementById('asset-title');
  const nextTitle = titleInput?.value.trim() || asset.title;
  return asset.title !== nextTitle || JSON.stringify(asset.drawing) !== JSON.stringify(serializeDrawingState());
}

function defaultAssetTitle() {
  const base = state.template ? `${state.template.name}` : '직접 그리기 도면';
  return `${base} ${new Date().toLocaleDateString('ko-KR')}`;
}

function serializeDrawingState() {
  return {
    schemaVersion: 1,
    mode: state.mode,
    templateCode: state.template?.code ?? null,
    templateName: state.template?.name ?? null,
    family: state.template?.family ?? null,
    dimensions: {
      width: state.cabinetW,
      height: state.cabinetH,
      depth: state.cabinetD,
    },
    items: state.items.map(item => ({ ...item })),
    led: state.led,
    finishColors: { ...state.finishColors },
    hingeConfig: {
      selectedDoor: state.hingeConfig.selectedDoor,
      doors: state.hingeConfig.doors.map(door => ({ ...door })),
    },
  };
}

async function restoreDrawingSnapshot(snapshot) {
  const templates = await loadDwgSampleTemplates();
  const template = snapshot?.mode === 'template'
    ? templates.find(tpl => tpl.code === snapshot.templateCode) ?? null
    : null;
  state.mode = template ? 'template' : 'custom';
  state.template = template;
  state.cabinetW = clamp(Number(snapshot?.dimensions?.width ?? 600), MIN_W, MAX_W);
  state.cabinetH = clamp(Number(snapshot?.dimensions?.height ?? 600), MIN_H, MAX_H);
  state.cabinetD = clamp(Number(snapshot?.dimensions?.depth ?? 300), 100, 1200);
  state.items = Array.isArray(snapshot?.items) ? snapshot.items.map(item => ({ ...item })) : [];
  state.itemCounter = state.items.reduce((max, item) => {
    const number = Number(String(item.id ?? '').replace(/^\D+/, ''));
    return Number.isFinite(number) ? Math.max(max, number) : max;
  }, state.items.length);
  state.led = snapshot?.led ?? null;
  state.finishColors = { ...DEFAULT_FINISH_COLORS, ...(snapshot?.finishColors ?? {}) };
  state.hingeConfig = {
    selectedDoor: Number(snapshot?.hingeConfig?.selectedDoor ?? 1),
    doors: Array.isArray(snapshot?.hingeConfig?.doors) ? snapshot.hingeConfig.doors.map(door => ({ ...door })) : [],
  };
  state.selectedId = null;
  document.getElementById('ed-pname').textContent = template ? template.name : '직접 그리기';
  document.getElementById('ed-pcode').textContent = template ? template.code : 'CUSTOM';
  document.getElementById('wm-code').textContent = template ? template.code : 'CUSTOM';
  document.getElementById('in-width').value = state.cabinetW;
  document.getElementById('in-height').value = state.cabinetH;
  state.constraintNotice = validateDrawingState().valid ? '' : '저장된 도면에 제한 검토가 필요한 값이 있습니다.';
  ensureHingeConfig();
  refreshHingePanel();
  refreshColorControls();
  refreshLEDPills();
  refreshPlacedList();
  syncWorkflowPanel();
  showScreen('editor');
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

  const legs = shouldRenderLegSupports(tpl) ? renderTemplateThumbLegs(tpl, x, y, dw, dh) : '';

  return `<svg viewBox="0 0 ${boxW} ${boxH}" preserveAspectRatio="xMidYMid meet">
    <rect x="${x}" y="${y}" width="${dw}" height="${dh}" fill="#fbfaf6" stroke="#1a1815" stroke-width="1.5"/>
    ${internals}
    ${legs}
    <text x="${x + dw/2}" y="${y - 8}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="8" fill="#807d77">${w}</text>
    <text x="${x - 8}" y="${y + dh/2}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="8" fill="#807d77" transform="rotate(-90 ${x-8} ${y+dh/2})">${h}</text>
  </svg>`;
}

function shouldRenderLegSupports(tpl) {
  return Boolean(tpl?.legSupportEvidence) || tpl?.mountType === 'legged';
}

function legEvidenceLabel(tpl) {
  return tpl?.legSupportEvidence ? 'DWG leg-support geometry · needs_review' : 'draft legged mount · needs_review';
}

function renderTemplateThumbLegs(tpl, x, y, width, height) {
  const legPositions = legCenterRatios(tpl);
  const legW = 7;
  const legH = Math.min(18, Math.max(10, height * 0.14));
  return legPositions.map(ratio => {
    const cx = x + width * ratio;
    return `<path d="M ${cx - legW/2} ${y + height} L ${cx - legW} ${y + height + legH} M ${cx + legW/2} ${y + height} L ${cx + legW} ${y + height + legH}" stroke="#1a1815" stroke-width="1.2" stroke-linecap="round"/>`;
  }).join('');
}

/* ============================================================
   ENTER EDITOR
   ============================================================ */

function enterEditor({ template } = {}) {
  state.items = [];
  state.led = null;
  state.finishColors = { ...DEFAULT_FINISH_COLORS };
  state.selectedId = null;
  state.itemCounter = 0;
  state.hingeConfig = { selectedDoor: 1, doors: [] };
  state.currentAssetId = null;
  state.reviewStatus = 'draft';
  state.comments = [];
  state.constraintNotice = '';

  if (template) {
    state.mode = 'template';
    state.template = template;
    state.cabinetW = template.defaultW;
    state.cabinetH = template.defaultH;
    state.cabinetD = template.defaultD;
    document.getElementById('ed-pname').textContent = template.name;
    document.getElementById('ed-pcode').textContent = template.code;
    document.getElementById('wm-code').textContent = template.code;
  } else {
    state.mode = 'custom';
    state.template = null;
    state.cabinetW = 600;
    state.cabinetH = 600;
    state.cabinetD = 300;
    document.getElementById('ed-pname').textContent = '직접 그리기';
    document.getElementById('ed-pcode').textContent = 'CUSTOM';
    document.getElementById('wm-code').textContent = 'CUSTOM';
  }

  document.getElementById('in-width').value = state.cabinetW;
  document.getElementById('in-height').value = state.cabinetH;
  if (workflowEls.title) {
    workflowEls.title.dataset.assetId = '';
    workflowEls.title.value = defaultAssetTitle();
  }
  ensureHingeConfig();
  refreshHingePanel();
  refreshColorControls();
  refreshLEDPills();
  refreshPlacedList();
  syncWorkflowPanel();
  showScreen('editor');
}

/* ============================================================
   DRAWING ASSET / REVIEW WORKFLOW
   ============================================================ */

const workflowEls = {
  roleSelect: document.getElementById('role-select'),
  roleLabel: document.getElementById('role-label'),
  status: document.getElementById('asset-status'),
  title: document.getElementById('asset-title'),
  list: document.getElementById('asset-list'),
  commentInput: document.getElementById('comment-input'),
  commentList: document.getElementById('comment-list'),
  adminActions: document.getElementById('admin-actions'),
  save: document.getElementById('btn-save-asset'),
  share: document.getElementById('btn-share-asset'),
  addComment: document.getElementById('btn-add-comment'),
  approve: document.getElementById('btn-approve'),
  reject: document.getElementById('btn-reject'),
  constraintStatus: document.getElementById('constraint-status'),
  constraintList: document.getElementById('constraint-list'),
};

const dashboardEls = {
  roleSelect: document.getElementById('ops-role-select'),
  roleLabel: document.getElementById('ops-role-label'),
  summary: document.getElementById('ops-summary'),
  notificationMeta: document.getElementById('ops-notification-meta'),
  notificationList: document.getElementById('ops-notification-list'),
  queueCount: document.getElementById('ops-queue-count'),
  filter: document.getElementById('ops-filter'),
  queue: document.getElementById('ops-queue'),
  detailHead: document.getElementById('ops-detail-head'),
  thread: document.getElementById('ops-thread'),
  commentInput: document.getElementById('ops-comment-input'),
  sendComment: document.getElementById('ops-comment-send'),
  openEditor: document.getElementById('ops-open-editor'),
  approve: document.getElementById('ops-approve'),
  reject: document.getElementById('ops-reject'),
};

workflowEls.roleSelect?.addEventListener('change', e => {
  state.role = e.target.value === 'admin' ? 'admin' : 'sales';
  syncWorkflowSurfaces();
});

workflowEls.title?.addEventListener('input', syncWorkflowPanel);

workflowEls.save?.addEventListener('click', async () => {
  await saveCurrentAsset({ share: false });
});

workflowEls.share?.addEventListener('click', async () => {
  await saveCurrentAsset({ share: true });
});

workflowEls.addComment?.addEventListener('click', async () => {
  await addWorkflowComment();
});

workflowEls.commentInput?.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') addWorkflowComment();
});

workflowEls.approve?.addEventListener('click', async () => setReviewDecision('approved'));
workflowEls.reject?.addEventListener('click', async () => setReviewDecision('rejected'));

dashboardEls.roleSelect?.addEventListener('change', e => {
  state.role = e.target.value === 'admin' ? 'admin' : 'sales';
  state.dashboardFilter = 'all';
  syncWorkflowSurfaces();
});

dashboardEls.filter?.addEventListener('click', e => {
  const button = e.target.closest('[data-dashboard-filter]');
  if (!button) return;
  state.dashboardFilter = button.dataset.dashboardFilter || 'all';
  renderDashboard();
});

dashboardEls.summary?.addEventListener('click', e => {
  const button = e.target.closest('[data-dashboard-filter]');
  if (!button) return;
  state.dashboardFilter = button.dataset.dashboardFilter || 'all';
  renderDashboard();
});

dashboardEls.notificationList?.addEventListener('click', e => {
  const button = e.target.closest('[data-asset-id]');
  if (!button?.dataset.assetId) return;
  selectDashboardAsset(button.dataset.assetId);
});

dashboardEls.queue?.addEventListener('click', e => {
  const button = e.target.closest('[data-asset-id]');
  if (!button?.dataset.assetId) return;
  selectDashboardAsset(button.dataset.assetId);
});

dashboardEls.sendComment?.addEventListener('click', async () => {
  await addDashboardComment();
});

dashboardEls.commentInput?.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') addDashboardComment();
});

dashboardEls.openEditor?.addEventListener('click', async () => {
  const asset = activeAsset();
  if (!asset) return;
  await loadAsset(asset.id);
});

dashboardEls.approve?.addEventListener('click', async () => setReviewDecision('approved'));
dashboardEls.reject?.addEventListener('click', async () => setReviewDecision('rejected'));

async function saveCurrentAsset({ share = false } = {}) {
  if (state.role !== 'sales') {
    state.constraintNotice = '도면 저장과 공유는 영업 사원 역할에서만 가능합니다.';
    syncWorkflowSurfaces();
    return null;
  }
  const validation = validateDrawingState();
  if (!validation.valid) {
    state.constraintNotice = '제한 규칙을 벗어난 도면은 저장할 수 없습니다.';
    syncWorkflowSurfaces();
    return null;
  }

  const now = nowIso();
  const existing = activeAsset();
  const drawing = serializeDrawingState();
  const title = workflowEls.title?.value.trim() || existing?.title || defaultAssetTitle();
  const drawingChanged = existing ? JSON.stringify(existing.drawing) !== JSON.stringify(drawing) : false;
  const titleChanged = existing ? existing.title !== title : false;
  const reviewedStatusChanged = (drawingChanged || titleChanged) && ['approved', 'rejected'].includes(existing?.reviewStatus);
  const nextStatus = share
    ? 'in_review'
    : reviewedStatusChanged
      ? 'draft'
      : (existing?.reviewStatus ?? state.reviewStatus ?? 'draft');
  const comments = existing?.comments ?? state.comments ?? [];
  const asset = {
    id: existing?.id ?? makeAssetId(),
    title,
    reviewStatus: nextStatus,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    sharedAt: share ? now : existing?.sharedAt ?? null,
    createdBy: existing?.createdBy ?? 'sales',
    drawing,
    comments: reviewedStatusChanged
      ? [...comments, {
          id: `comment-${Date.now()}`,
          role: state.role,
          author: ROLE_LABELS[state.role],
          text: share
            ? '검토 완료 후 도면이 수정되어 검토중으로 다시 공유되었습니다.'
            : '검토 완료 후 도면이 수정되어 상태가 작성중으로 변경되었습니다.',
          createdAt: now,
          system: true,
        }]
      : comments,
  };

  try {
    const payload = await requestJson('/api/assets', {
      method: 'POST',
      body: JSON.stringify({ role: state.role, action: share ? 'share' : 'save', asset }),
    });
    if (Array.isArray(payload.assets)) state.assets = payload.assets.filter(isStoredAsset);
    upsertAsset(payload.asset);
  } catch (_error) {
    upsertAsset(asset);
    state.constraintNotice = '서버 저장소에 연결할 수 없어 브라우저 임시 저장소에만 반영했습니다.';
    syncWorkflowSurfaces();
    return asset;
  }
  state.constraintNotice = share ? '관리자 검토 목록으로 공유했습니다.' : '편집 가능한 도면 데이터로 저장했습니다.';
  syncWorkflowSurfaces();
  return activeAsset();
}

async function loadAsset(assetId) {
  const asset = state.assets.find(item => item.id === assetId);
  if (!asset) return;
  state.currentAssetId = asset.id;
  state.reviewStatus = asset.reviewStatus;
  state.comments = asset.comments ?? [];
  await restoreDrawingSnapshot(asset.drawing);
  state.constraintNotice = '저장된 도면 데이터를 다시 열었습니다.';
  syncWorkflowPanel();
}

async function persistAssetComment(asset, text) {
  if (!asset) return;
  try {
    const payload = await requestJson(`/api/assets/${encodeURIComponent(asset.id)}/comments`, {
      method: 'POST',
      body: JSON.stringify({ role: state.role, text }),
    });
    if (Array.isArray(payload.assets)) state.assets = payload.assets.filter(isStoredAsset);
    upsertAsset(payload.asset);
  } catch (_error) {
    const comment = {
      id: `comment-${Date.now()}`,
      role: state.role,
      author: ROLE_LABELS[state.role],
      text,
      createdAt: nowIso(),
    };
    asset.comments = [...(asset.comments ?? []), comment];
    asset.updatedAt = nowIso();
    upsertAsset(asset);
    state.constraintNotice = '서버 저장소에 연결할 수 없어 댓글을 브라우저 임시 저장소에만 남겼습니다.';
  }
  return activeAsset();
}

async function addWorkflowComment() {
  const text = workflowEls.commentInput?.value.trim();
  if (!text) return;
  let asset = activeAsset();
  if (!asset) asset = await saveCurrentAsset({ share: false });
  if (!asset) return;
  await persistAssetComment(asset, text);
  workflowEls.commentInput.value = '';
  syncWorkflowSurfaces();
}

async function addDashboardComment() {
  const text = dashboardEls.commentInput?.value.trim();
  if (!text) return;
  const asset = activeAsset();
  if (!asset) return;
  await persistAssetComment(asset, text);
  dashboardEls.commentInput.value = '';
  syncWorkflowSurfaces();
}

async function setReviewDecision(reviewStatus) {
  if (state.role !== 'admin') return;
  const asset = activeAsset();
  if (!asset || asset.reviewStatus !== 'in_review') return;
  try {
    const payload = await requestJson(`/api/assets/${encodeURIComponent(asset.id)}/decision`, {
      method: 'POST',
      body: JSON.stringify({ role: state.role, reviewStatus }),
    });
    if (Array.isArray(payload.assets)) state.assets = payload.assets.filter(isStoredAsset);
    upsertAsset(payload.asset);
    state.constraintNotice = '';
  } catch (_error) {
    asset.reviewStatus = reviewStatus;
    asset.updatedAt = nowIso();
    state.reviewStatus = reviewStatus;
    const decisionText = reviewStatus === 'approved' ? '관리자가 도면을 승인했습니다.' : '관리자가 도면을 반려했습니다.';
    asset.comments = [...(asset.comments ?? []), {
      id: `comment-${Date.now()}`,
      role: 'admin',
      author: ROLE_LABELS.admin,
      text: decisionText,
      createdAt: nowIso(),
      system: true,
    }];
    upsertAsset(asset);
    state.constraintNotice = '서버 저장소에 연결할 수 없어 승인 상태를 브라우저 임시 저장소에만 반영했습니다.';
  }
  if (state.screen === 'dashboard') state.dashboardFilter = reviewStatus;
  syncWorkflowSurfaces();
}

function syncWorkflowTitleInput(asset) {
  if (!workflowEls.title) return;
  const nextAssetId = asset?.id ?? '';
  if (nextAssetId && workflowEls.title.dataset.assetId !== nextAssetId) {
    workflowEls.title.value = asset.title ?? '';
  } else if (!nextAssetId && !workflowEls.title.value.trim()) {
    workflowEls.title.value = defaultAssetTitle();
  }
  workflowEls.title.dataset.assetId = nextAssetId;
}

function syncWorkflowPanel() {
  if (!workflowEls.status) return;
  workflowEls.roleSelect.value = state.role;
  workflowEls.roleLabel.textContent = ROLE_LABELS[state.role];
  const asset = activeAsset();
  const drawingChanged = activeDrawingChanged(asset);
  const reviewStatus = drawingChanged && ['approved', 'rejected'].includes(asset?.reviewStatus)
    ? 'draft'
    : asset?.reviewStatus ?? state.reviewStatus ?? 'draft';
  workflowEls.status.textContent = asset
    ? drawingChanged && ['approved', 'rejected'].includes(asset.reviewStatus)
      ? '수정됨'
      : REVIEW_STATUS[reviewStatus]
    : '새 도면';
  workflowEls.status.className = `status-chip ${REVIEW_STATUS_CLASS[reviewStatus] ?? 'draft'}`;
  syncWorkflowTitleInput(asset);
  const validation = validateDrawingState();
  workflowEls.save.disabled = !validation.valid || state.role !== 'sales';
  workflowEls.share.disabled = !validation.valid || state.role !== 'sales';
  workflowEls.share.textContent = asset?.reviewStatus === 'in_review' ? '공유 갱신' : '관리자 공유';
  workflowEls.adminActions.hidden = state.role !== 'admin';
  const adminReviewable = state.role === 'admin' && asset?.reviewStatus === 'in_review';
  workflowEls.approve.disabled = !adminReviewable || !validation.valid;
  workflowEls.reject.disabled = !adminReviewable;
  updateConstraintPanel(validation);
  renderAssetList();
  renderCommentList(asset?.comments ?? state.comments ?? []);
}

function renderAssetList() {
  if (!workflowEls.list) return;
  if (!state.assets.length) {
    workflowEls.list.innerHTML = '<div class="empty-hint">저장된 도면이 없습니다.</div>';
    return;
  }
  workflowEls.list.innerHTML = '';
  state.assets.slice(0, 8).forEach(asset => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `asset-row${asset.id === state.currentAssetId ? ' active' : ''}`;
    row.innerHTML = `
      <span class="asset-row-title">${escapeHtml(asset.title)}</span>
      <span class="asset-row-status">${escapeHtml(REVIEW_STATUS[asset.reviewStatus] ?? asset.reviewStatus)}</span>
      <span class="asset-row-meta">${escapeHtml(asset.drawing?.templateName ?? '직접 그리기')} · ${escapeHtml(formatShortTime(asset.updatedAt))}</span>
    `;
    row.addEventListener('click', () => loadAsset(asset.id));
    workflowEls.list.appendChild(row);
  });
}

function renderCommentList(comments) {
  if (!workflowEls.commentList) return;
  workflowEls.commentList.innerHTML = renderThreadMessages(formatThreadMessages(comments), '아직 댓글이 없습니다.');
}

function selectDashboardAsset(assetId) {
  const asset = state.assets.find(item => item.id === assetId);
  if (!asset) return;
  if (state.dashboardFilter !== 'all' && asset.reviewStatus !== state.dashboardFilter) {
    state.dashboardFilter = 'all';
  }
  state.currentAssetId = assetId;
  renderDashboard();
}

function renderDashboard() {
  if (!dashboardEls.summary) return;
  dashboardEls.roleSelect.value = state.role;
  dashboardEls.roleLabel.textContent = ROLE_LABELS[state.role];

  let model = buildDashboardModel(state.assets, {
    role: state.role,
    filter: state.dashboardFilter,
    activeAssetId: state.currentAssetId,
  });
  const queueHasActive = model.queue.some(asset => asset.id === state.currentAssetId);
  if (model.queue.length && !queueHasActive) {
    state.currentAssetId = model.queue[0].id;
    model = buildDashboardModel(state.assets, {
      role: state.role,
      filter: state.dashboardFilter,
      activeAssetId: state.currentAssetId,
    });
  } else if (!model.queue.length && state.dashboardFilter !== 'all') {
    model = { ...model, activeAsset: null, thread: [] };
  } else if (model.activeAsset) {
    state.currentAssetId = model.activeAsset.id;
  }

  renderDashboardSummary(model);
  renderDashboardNotifications(model);
  renderDashboardQueue(model);
  renderDashboardDetail(model);
}

function renderDashboardSummary(model) {
  const counts = model.counts;
  const items = [
    { filter: 'in_review', label: '검토중', count: counts.in_review, meta: '승인 대기' },
    { filter: 'rejected', label: '반려', count: counts.rejected, meta: '수정 필요' },
    { filter: 'approved', label: '승인', count: counts.approved, meta: '완료' },
    { filter: 'draft', label: '작성중', count: counts.draft, meta: '영업 보관' },
  ];
  dashboardEls.summary.innerHTML = items.map(item => `
    <button type="button" class="ops-summary-tile ${state.dashboardFilter === item.filter ? 'active' : ''}" data-dashboard-filter="${item.filter}">
      <span>${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.count)}</strong>
      <small>${escapeHtml(item.meta)}</small>
    </button>
  `).join('');
}

function renderDashboardNotifications(model) {
  const actionable = model.notifications.filter(item => item.assetId).length;
  dashboardEls.notificationMeta.textContent = `${actionable}개`;
  dashboardEls.notificationList.innerHTML = model.notifications.map(notification => `
    <button type="button" class="ops-notification ${escapeHtml(notification.tone)}" ${notification.assetId ? `data-asset-id="${escapeHtml(notification.assetId)}"` : 'disabled'}>
      <span class="ops-notification-dot"></span>
      <span class="ops-notification-body">
        <strong>${escapeHtml(notification.title)}</strong>
        <span>${escapeHtml(notification.text)}</span>
      </span>
      <time>${escapeHtml(formatShortTime(notification.createdAt))}</time>
    </button>
  `).join('');
}

function renderDashboardQueue(model) {
  dashboardEls.queueCount.textContent = `${model.queue.length}건`;
  dashboardEls.filter.querySelectorAll('[data-dashboard-filter]').forEach(button => {
    button.classList.toggle('active', button.dataset.dashboardFilter === state.dashboardFilter);
  });
  if (!model.queue.length) {
    dashboardEls.queue.innerHTML = '<div class="empty-hint">표시할 도면이 없습니다.</div>';
    return;
  }
  dashboardEls.queue.innerHTML = model.queue.map(asset => `
    <button type="button" class="ops-queue-row ${asset.id === model.activeAsset?.id ? 'active' : ''}" data-asset-id="${escapeHtml(asset.id)}">
      <span class="ops-queue-title">${escapeHtml(asset.title)}</span>
      <span class="status-chip ${REVIEW_STATUS_CLASS[asset.reviewStatus] ?? 'draft'}">${escapeHtml(statusLabel(asset.reviewStatus))}</span>
      <span class="ops-queue-sub">${escapeHtml(formatAssetSubtitle(asset))}</span>
      <span class="ops-queue-time">${escapeHtml(formatShortTime(asset.updatedAt))}</span>
    </button>
  `).join('');
}

function renderDashboardDetail(model) {
  const asset = model.activeAsset;
  const hasAsset = Boolean(asset);
  dashboardEls.openEditor.disabled = !hasAsset;
  dashboardEls.sendComment.disabled = !hasAsset;
  dashboardEls.commentInput.disabled = !hasAsset;
  const adminReviewable = state.role === 'admin' && asset?.reviewStatus === 'in_review';
  dashboardEls.approve.disabled = !adminReviewable;
  dashboardEls.reject.disabled = !adminReviewable;

  if (!asset) {
    dashboardEls.detailHead.innerHTML = `
      <div>
        <span class="ops-kicker">THREAD</span>
        <h3>선택된 도면 없음</h3>
      </div>
      <span class="status-chip draft">대기</span>
    `;
    dashboardEls.thread.innerHTML = '<div class="empty-hint">승인 요청 또는 댓글 알림을 선택하세요.</div>';
    return;
  }

  dashboardEls.detailHead.innerHTML = `
    <div>
      <span class="ops-kicker">THREAD</span>
      <h3>${escapeHtml(asset.title)}</h3>
      <p>${escapeHtml(formatAssetSubtitle(asset))} · 댓글 ${escapeHtml((asset.comments ?? []).length)}개</p>
    </div>
    <span class="status-chip ${REVIEW_STATUS_CLASS[asset.reviewStatus] ?? 'draft'}">${escapeHtml(statusLabel(asset.reviewStatus))}</span>
  `;
  dashboardEls.thread.innerHTML = renderThreadMessages(model.thread, '아직 댓글이 없습니다.');
}

function renderThreadMessages(messages, emptyText) {
  if (!messages.length) return `<div class="empty-hint">${escapeHtml(emptyText)}</div>`;
  return `
    <div class="thread-list">
      ${messages.map(message => `
        <div class="thread-message ${escapeHtml(message.side)}">
          <div class="thread-bubble">
            <div class="comment-meta">
              <span>${escapeHtml(message.system ? '상태' : message.author)}</span>
              <span>${escapeHtml(formatShortTime(message.createdAt))}</span>
            </div>
            <div class="comment-text">${escapeHtml(message.text)}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

/* ============================================================
   DIMENSION INPUT
   ============================================================ */

document.getElementById('in-width').addEventListener('input', e => {
  let v = parseInt(e.target.value) || 0;
  if (v < MIN_W) return; // allow user to keep typing
  commitDimensionCandidate({ width: v });
});
document.getElementById('in-height').addEventListener('input', e => {
  let v = parseInt(e.target.value) || 0;
  if (v < MIN_H) return;
  commitDimensionCandidate({ height: v });
});
document.getElementById('in-width').addEventListener('blur', e => {
  const value = parseInt(e.target.value) || MIN_W;
  if (value === state.cabinetW) {
    e.target.value = state.cabinetW;
    syncWorkflowPanel();
    return;
  }
  commitDimensionCandidate({ width: value });
});
document.getElementById('in-height').addEventListener('blur', e => {
  const value = parseInt(e.target.value) || MIN_H;
  if (value === state.cabinetH) {
    e.target.value = state.cabinetH;
    syncWorkflowPanel();
    return;
  }
  commitDimensionCandidate({ height: value });
});

/* ============================================================
   HINGE ADJUSTMENT
   ============================================================ */

const hingeEls = {
  panel: document.getElementById('hinge-panel'),
  door: document.getElementById('hinge-door'),
  side: document.getElementById('hinge-side'),
  top: document.getElementById('hinge-top'),
  bottom: document.getElementById('hinge-bottom'),
  reset: document.getElementById('hinge-reset'),
};

function hingedDoorCount() {
  const options = state.template?.rawTemplate?.defaults?.options ?? {};
  if (options.sliding || state.template?.family === '슬라이징장') return 0;
  if (Number(options.flapCount ?? 0) > 0 || state.template?.family === '플랩장') return 0;
  return Math.max(0, Number(options.doorCount ?? 0));
}

function defaultHingeSide(index, doorCount) {
  if (doorCount <= 1) return 'right';
  return index % 2 === 0 ? 'left' : 'right';
}

function defaultHingeDoor(index, doorCount) {
  return {
    side: defaultHingeSide(index, doorCount),
    top: snapStep(Math.max(40, state.cabinetH * 0.28)),
    bottom: snapStep(Math.min(state.cabinetH - 40, state.cabinetH * 0.72)),
  };
}

function sanitizeHingeDoor(door, index, doorCount) {
  const minGap = Math.min(140, Math.max(60, state.cabinetH * 0.16));
  const minY = 20;
  const maxY = Math.max(minY + minGap, state.cabinetH - 20);
  const side = door?.side === 'right' ? 'right' : door?.side === 'left' ? 'left' : defaultHingeSide(index, doorCount);
  let top = snapStep(clamp(Number(door?.top ?? state.cabinetH * 0.28), minY, maxY - minGap));
  let bottom = snapStep(clamp(Number(door?.bottom ?? state.cabinetH * 0.72), top + minGap, maxY));
  if (bottom <= top) {
    bottom = snapStep(clamp(top + minGap, minY + minGap, maxY));
  }
  return { side, top, bottom };
}

function ensureHingeConfig({ reset = false } = {}) {
  const doorCount = hingedDoorCount();
  if (!doorCount) {
    state.hingeConfig = { selectedDoor: 1, doors: [] };
    return;
  }
  const current = reset ? [] : state.hingeConfig?.doors ?? [];
  state.hingeConfig = {
    selectedDoor: clamp(Number(state.hingeConfig?.selectedDoor ?? 1), 1, doorCount),
    doors: Array.from({ length: doorCount }, (_, index) => sanitizeHingeDoor(current[index] ?? defaultHingeDoor(index, doorCount), index, doorCount)),
  };
}

function selectedHingeDoor() {
  ensureHingeConfig();
  return state.hingeConfig.doors[state.hingeConfig.selectedDoor - 1];
}

function refreshHingePanel() {
  if (!hingeEls.panel) return;
  const doorCount = hingedDoorCount();
  if (!doorCount) {
    hingeEls.panel.hidden = true;
    return;
  }
  ensureHingeConfig();
  hingeEls.panel.hidden = false;
  const selected = state.hingeConfig.selectedDoor;
  if (hingeEls.door.options.length !== doorCount) {
    hingeEls.door.innerHTML = Array.from({ length: doorCount }, (_, index) => `<option value="${index + 1}">${index + 1}번 도어</option>`).join('');
  }
  hingeEls.door.value = String(selected);
  const door = selectedHingeDoor();
  hingeEls.side.value = door.side;
  hingeEls.top.max = Math.max(20, state.cabinetH - 40);
  hingeEls.bottom.max = Math.max(40, state.cabinetH - 20);
  hingeEls.top.value = Math.round(door.top);
  hingeEls.bottom.value = Math.round(door.bottom);
}

function updateSelectedHingeDoor(patch) {
  ensureHingeConfig();
  const index = state.hingeConfig.selectedDoor - 1;
  state.hingeConfig.doors[index] = sanitizeHingeDoor({ ...state.hingeConfig.doors[index], ...patch }, index, hingedDoorCount());
  refreshHingePanel();
  render();
}

hingeEls.door?.addEventListener('change', e => {
  state.hingeConfig.selectedDoor = Number(e.target.value) || 1;
  refreshHingePanel();
  render();
});
hingeEls.side?.addEventListener('change', e => updateSelectedHingeDoor({ side: e.target.value }));
hingeEls.top?.addEventListener('input', e => updateSelectedHingeDoor({ top: Number(e.target.value) }));
hingeEls.bottom?.addEventListener('input', e => updateSelectedHingeDoor({ bottom: Number(e.target.value) }));
hingeEls.reset?.addEventListener('click', () => {
  ensureHingeConfig({ reset: true });
  refreshHingePanel();
  render();
});

/* ============================================================
   COLOR / FINISH
   ============================================================ */

const colorEls = {
  exteriorPreset: document.getElementById('color-exterior-preset'),
  interiorPreset: document.getElementById('color-interior-preset'),
  exterior: document.getElementById('color-exterior'),
  interior: document.getElementById('color-interior'),
};

function normalizeHexColor(value, fallback) {
  const text = String(value ?? '').trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : fallback;
}

function colorLabel(kind) {
  const value = state.finishColors[kind];
  const select = kind === 'exterior' ? colorEls.exteriorPreset : colorEls.interiorPreset;
  const match = [...(select?.options ?? [])].find(option => option.value.toLowerCase() === value.toLowerCase());
  return match ? `${match.textContent} (${value})` : `직접 선택 (${value})`;
}

function refreshColorControls() {
  if (!colorEls.exterior || !colorEls.interior) return;
  state.finishColors.exterior = normalizeHexColor(state.finishColors.exterior, DEFAULT_FINISH_COLORS.exterior);
  state.finishColors.interior = normalizeHexColor(state.finishColors.interior, DEFAULT_FINISH_COLORS.interior);
  colorEls.exterior.value = state.finishColors.exterior;
  colorEls.interior.value = state.finishColors.interior;
  if (colorEls.exteriorPreset) colorEls.exteriorPreset.value = [...colorEls.exteriorPreset.options].some(option => option.value.toLowerCase() === state.finishColors.exterior) ? state.finishColors.exterior : DEFAULT_FINISH_COLORS.exterior;
  if (colorEls.interiorPreset) colorEls.interiorPreset.value = [...colorEls.interiorPreset.options].some(option => option.value.toLowerCase() === state.finishColors.interior) ? state.finishColors.interior : DEFAULT_FINISH_COLORS.interior;
}

function updateFinishColor(kind, value) {
  state.finishColors[kind] = normalizeHexColor(value, DEFAULT_FINISH_COLORS[kind]);
  refreshColorControls();
  render();
}

colorEls.exteriorPreset?.addEventListener('change', e => updateFinishColor('exterior', e.target.value));
colorEls.interiorPreset?.addEventListener('change', e => updateFinishColor('interior', e.target.value));
colorEls.exterior?.addEventListener('input', e => updateFinishColor('exterior', e.target.value));
colorEls.interior?.addEventListener('input', e => updateFinishColor('interior', e.target.value));

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

  const item = findValidItemPlacement({ id, type, x, y, w, h }, state.items);
  if (!item) {
    state.constraintNotice = `${def.name}을 현재 도면에 유효하게 배치할 공간이 없습니다.`;
    syncWorkflowPanel();
    return;
  }
  state.items.push(item);
  state.selectedId = id;
  state.constraintNotice = '';
  refreshPlacedList();
  syncWorkflowPanel();
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
      syncWorkflowPanel();
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
    const next = (state.led === v) ? null : v;
    const previous = state.led;
    state.led = next;
    const validation = validateDrawingState();
    if (!validation.valid) {
      state.led = previous;
      state.constraintNotice = validation.errors[0] ?? 'LED 배치 제한을 벗어났습니다.';
    } else {
      state.constraintNotice = '';
    }
    refreshLEDPills();
    syncWorkflowPanel();
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

function itemClearance(item) {
  if (item.type === 'outlet1' || item.type === 'outlet2') return GENERIC_CONSTRAINTS.outletClearance;
  if (item.type === 'shelf' || item.type === 'guidebar') return GENERIC_CONSTRAINTS.edgeClearance;
  return GENERIC_CONSTRAINTS.edgeClearance;
}

function itemRect(item, gap = 0) {
  return {
    left: item.x - gap,
    top: item.y - gap,
    right: item.x + item.w + gap,
    bottom: item.y + item.h + gap,
  };
}

function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function normalizeItemSize(item, bounds = cabinetBounds()) {
  const def = OPT_DEFS[item.type];
  const minW = def?.minW || 20;
  return {
    ...item,
    w: snapStep(clamp(Number(item.w ?? def?.w ?? minW), minW, bounds.width)),
    h: clamp(Number(item.h ?? def?.h ?? 20), 1, bounds.height),
  };
}

function cabinetBounds(overrides = {}) {
  return {
    width: overrides.width ?? state.cabinetW,
    height: overrides.height ?? state.cabinetH,
    depth: overrides.depth ?? state.cabinetD,
  };
}

function placementErrors(item, others = state.items, bounds = cabinetBounds(), led = state.led) {
  const errors = [];
  const def = OPT_DEFS[item.type];
  if (!def) return ['알 수 없는 옵션입니다.'];
  const clearance = itemClearance(item);
  if (item.w < (def.minW || 20)) errors.push(`${def.name} 폭은 최소 ${(def.minW || 20)}mm 이상이어야 합니다.`);
  if (item.x < clearance) errors.push(`${def.name}은 좌측에서 ${clearance}mm 이상 떨어져야 합니다.`);
  if (item.y < clearance) errors.push(`${def.name}은 상단에서 ${clearance}mm 이상 떨어져야 합니다.`);
  if (item.x + item.w > bounds.width - clearance) errors.push(`${def.name}은 우측에서 ${clearance}mm 이상 떨어져야 합니다.`);
  if (item.y + item.h > bounds.height - clearance) errors.push(`${def.name}은 하단에서 ${clearance}mm 이상 떨어져야 합니다.`);
  if ((item.type === 'outlet1' || item.type === 'outlet2') && led && item.y + item.h > bounds.height - GENERIC_CONSTRAINTS.ledReservedBottom) {
    errors.push('콘센트는 LED 하단 예약 영역과 겹칠 수 없습니다.');
  }
  const rect = itemRect(item, GENERIC_CONSTRAINTS.optionGap);
  for (const other of others) {
    if (other.id === item.id) continue;
    if (rectsOverlap(rect, itemRect(other, 0))) {
      errors.push(`${def.name}은 ${OPT_DEFS[other.type]?.name ?? '다른 옵션'}과 겹칠 수 없습니다.`);
      break;
    }
  }
  return errors;
}

function fitItemInsideCabinet(item, bounds = cabinetBounds()) {
  const sized = normalizeItemSize(item, bounds);
  const clearance = itemClearance(sized);
  const maxX = Math.max(clearance, bounds.width - clearance - sized.w);
  const maxY = Math.max(clearance, bounds.height - clearance - sized.h);
  return {
    ...sized,
    x: snapStep(clamp(Number(sized.x ?? clearance), clearance, maxX)),
    y: snapStep(clamp(Number(sized.y ?? clearance), clearance, maxY)),
  };
}

function findValidItemPlacement(item, others = state.items, bounds = cabinetBounds()) {
  const base = fitItemInsideCabinet(item, bounds);
  if (!placementErrors(base, others, bounds).length) return base;
  const clearance = itemClearance(base);
  const maxX = Math.max(clearance, bounds.width - clearance - base.w);
  const maxY = Math.max(clearance, bounds.height - clearance - base.h);
  for (let y = clearance; y <= maxY; y += STEP) {
    for (let x = clearance; x <= maxX; x += STEP) {
      const candidate = { ...base, x, y };
      if (!placementErrors(candidate, others, bounds).length) return candidate;
    }
  }
  return null;
}

function commitItemCandidate(id, patch) {
  const item = state.items.find(entry => entry.id === id);
  if (!item) return false;
  const candidate = fitItemInsideCabinet({ ...item, ...patch });
  const errors = placementErrors(candidate, state.items);
  if (errors.length) {
    state.constraintNotice = errors[0];
    syncWorkflowPanel();
    return false;
  }
  Object.assign(item, candidate);
  state.constraintNotice = '';
  return true;
}

function templateDimensionErrors(bounds = cabinetBounds()) {
  if (!state.template) return [];
  const rules = state.template.rawTemplate?.constraints?.dimensions ?? {};
  const labels = { width: '가로', height: '세로', depth: '깊이' };
  const values = { width: bounds.width, height: bounds.height, depth: bounds.depth };
  const errors = [];
  for (const [key, rule] of Object.entries(rules)) {
    const value = Number(values[key]);
    if (!Number.isFinite(value)) continue;
    const label = labels[key] ?? key;
    if (Number.isFinite(rule.min) && value < rule.min) errors.push(`${state.template.family} ${label}는 최소 ${rule.min}mm 이상이어야 합니다.`);
    if (Number.isFinite(rule.max) && value > rule.max) errors.push(`${state.template.family} ${label}는 최대 ${rule.max}mm 이하여야 합니다.`);
    if (Number.isFinite(rule.step) && rule.step > 0 && (value - (rule.min ?? 0)) % rule.step !== 0) {
      errors.push(`${state.template.family} ${label}는 ${rule.step}mm 단위로만 조정할 수 있습니다.`);
    }
  }
  return errors;
}

function validateDrawingState(candidate = {}) {
  const bounds = cabinetBounds(candidate);
  const items = candidate.items ?? state.items;
  const led = candidate.led ?? state.led;
  const errors = [];
  if (state.mode) {
    if (bounds.width < MIN_W || bounds.width > MAX_W) errors.push(`가로는 ${MIN_W}-${MAX_W}mm 범위여야 합니다.`);
    if (bounds.height < MIN_H || bounds.height > MAX_H) errors.push(`세로는 ${MIN_H}-${MAX_H}mm 범위여야 합니다.`);
    errors.push(...templateDimensionErrors(bounds));
    if (led && bounds.height < GENERIC_CONSTRAINTS.minLedCabinetHeight) {
      errors.push(`LED는 세로 ${GENERIC_CONSTRAINTS.minLedCabinetHeight}mm 이상 도면에서만 배치할 수 있습니다.`);
    }
    for (const item of items) {
      errors.push(...placementErrors(item, items, bounds, led));
    }
  }
  const uniqueErrors = [...new Set(errors)];
  const notices = state.constraintNotice ? [state.constraintNotice] : [];
  return {
    valid: uniqueErrors.length === 0,
    errors: uniqueErrors,
    notices,
  };
}

function commitDimensionCandidate(patch) {
  const width = snapStep(clamp(Number(patch.width ?? state.cabinetW), MIN_W, MAX_W));
  const height = snapStep(clamp(Number(patch.height ?? state.cabinetH), MIN_H, MAX_H));
  const depth = clamp(Number(patch.depth ?? state.cabinetD), 100, 1200);
  const validation = validateDrawingState({ width, height, depth });
  if (!validation.valid) {
    state.constraintNotice = validation.errors[0] ?? '현재 도면을 유지해야 하는 제한 규칙이 있습니다.';
    syncWorkflowPanel();
    document.getElementById('in-width').value = state.cabinetW;
    document.getElementById('in-height').value = state.cabinetH;
    render();
    return false;
  }
  state.cabinetW = width;
  state.cabinetH = height;
  state.cabinetD = depth;
  state.constraintNotice = '';
  document.getElementById('in-width').value = state.cabinetW;
  document.getElementById('in-height').value = state.cabinetH;
  ensureHingeConfig();
  refreshHingePanel();
  syncWorkflowPanel();
  render();
  return true;
}

function updateConstraintPanel(validation = validateDrawingState()) {
  if (!workflowEls.constraintStatus || !workflowEls.constraintList) return;
  if (validation.valid) {
    workflowEls.constraintStatus.className = 'constraint-status valid';
    workflowEls.constraintStatus.textContent = '유효한 도면입니다. 저장과 공유가 가능합니다.';
  } else {
    workflowEls.constraintStatus.className = 'constraint-status blocked';
    workflowEls.constraintStatus.textContent = '제한 규칙 때문에 현재 도면은 저장할 수 없습니다.';
  }
  const messages = [...validation.errors, ...validation.notices];
  workflowEls.constraintList.innerHTML = messages.length
    ? messages.map(message => `<li>${escapeHtml(message)}</li>`).join('')
    : '<li>치수, 옵션 배치, 콘센트/LED 위치가 범용 제한 안에 있습니다.</li>';
}

/* ============================================================
   RENDERING
   ============================================================ */

const svg = document.getElementById('canvas');
svg.addEventListener('pointerdown', svgEmptyDown);

// margins around cabinet within viewBox (in mm) for dimensions and labels
const PAD_TOP = 100, PAD_BOTTOM = 150, PAD_LEFT = 100, PAD_RIGHT = 80;

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

  // Cabinet frame and finish colors
  parts.push(buildCabinetSurfaces());
  if (state.mode === 'template' && shouldRenderLegSupports(state.template)) {
    parts.push(buildLegSupports());
  }

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
  if (hingedDoorCount()) {
    parts.push(buildDoorHingeOverlay());
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
  svg.querySelectorAll('[data-door-hinge]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      state.hingeConfig.selectedDoor = Number(el.dataset.doorHinge) || 1;
      refreshHingePanel();
      render();
    });
  });

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

function buildCabinetSurfaces() {
  const exterior = normalizeHexColor(state.finishColors.exterior, DEFAULT_FINISH_COLORS.exterior);
  const interior = normalizeHexColor(state.finishColors.interior, DEFAULT_FINISH_COLORS.interior);
  const inset = Math.min(28, Math.max(12, Math.min(state.cabinetW, state.cabinetH) * 0.035));
  const innerW = Math.max(0, state.cabinetW - inset * 2);
  const innerH = Math.max(0, state.cabinetH - inset * 2);
  return `<g class="cabinet-finish" data-exterior-color="${exterior}" data-interior-color="${interior}">
    <rect class="cabinet-rect" x="0" y="0" width="${state.cabinetW}" height="${state.cabinetH}" fill="${exterior}"/>
    <rect class="cabinet-interior-surface" x="${inset}" y="${inset}" width="${innerW}" height="${innerH}" fill="${interior}" opacity="0.78"/>
    <text class="finish-label" x="${Math.min(12, state.cabinetW / 4)}" y="${Math.max(16, inset - 4)}">EXT ${exterior}</text>
    <text class="finish-label" x="${state.cabinetW - 12}" y="${Math.max(16, inset - 4)}" text-anchor="end">INT ${interior}</text>
  </g>`;
}

function buildDoorHingeOverlay() {
  const doorCount = hingedDoorCount();
  if (!doorCount) return '';
  ensureHingeConfig();
  const doorW = state.cabinetW / doorCount;
  const markW = Math.min(24, Math.max(14, doorW * 0.06));
  const markH = 18;
  const parts = [];
  for (let index = 0; index < doorCount; index += 1) {
    const door = state.hingeConfig.doors[index];
    const x = doorW * index;
    const side = door.side;
    const hingeX = side === 'left' ? x : x + doorW;
    const targetX = side === 'left' ? x + doorW : x;
    const hingeY = (door.top + door.bottom) / 2;
    const selected = state.hingeConfig.selectedDoor === index + 1;
    const markX = side === 'left' ? hingeX - markW / 2 : hingeX - markW / 2;
    const labelX = side === 'left' ? hingeX + 10 : hingeX - 10;
    const labelAnchor = side === 'left' ? 'start' : 'end';
    parts.push(`<g class="door-hinge-overlay" data-door-hinge="${index + 1}">
      <rect class="door-hinge-panel${selected ? ' selected' : ''}" x="${x}" y="0" width="${doorW}" height="${state.cabinetH}"/>
      <line class="door-opening-guide solid" x1="${hingeX}" y1="${hingeY}" x2="${targetX}" y2="0"/>
      <line class="door-opening-guide dashed" x1="${hingeX}" y1="${hingeY}" x2="${targetX}" y2="${state.cabinetH}"/>
      ${[door.top, door.bottom].map((y, hingeIndex) => `<g class="hinge-position-mark">
        <rect x="${markX}" y="${y - markH / 2}" width="${markW}" height="${markH}" rx="2"/>
        <text x="${hingeX}" y="${y + 3}" text-anchor="middle">H${hingeIndex + 1}</text>
      </g>`).join('')}
      <text class="hinge-label" x="${labelX}" y="${Math.max(16, door.top - 8)}" text-anchor="${labelAnchor}">D${index + 1} ${side === 'left' ? '좌경첩' : '우경첩'}</text>
    </g>`);
  }
  return `<g class="door-hinge-system" data-hinge-adjustable="true">${parts.join('')}</g>`;
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

function buildLegSupports() {
  const legH = Math.min(90, Math.max(55, state.cabinetH * 0.11));
  const legW = Math.min(34, Math.max(22, state.cabinetW * 0.035));
  return `<g class="template-leg-supports" data-dwg-leg-support="${state.template?.legSupportEvidence ? 'true' : 'false'}" data-leg-source="${state.template?.legSupportEvidence ? 'dwg_entity' : 'draft_template'}">
    ${legCenterRatios(state.template).map((ratio, index) => {
      const cx = state.cabinetW * ratio;
      const footY = state.cabinetH + legH;
      return `<g class="template-leg" data-leg-index="${index + 1}">
        <line x1="${cx - legW / 2}" y1="${state.cabinetH}" x2="${cx - legW}" y2="${footY}"/>
        <line x1="${cx + legW / 2}" y1="${state.cabinetH}" x2="${cx + legW}" y2="${footY}"/>
        <line x1="${cx - legW * 1.25}" y1="${footY}" x2="${cx + legW * 1.25}" y2="${footY}"/>
      </g>`;
    }).join('')}
    <text class="leg-evidence-label" x="${state.cabinetW / 2}" y="${state.cabinetH + legH + 24}" text-anchor="middle">${legEvidenceLabel(state.template)}</text>
  </g>`;
}

function legCenterRatios(tpl) {
  const pairCount = Number(tpl?.legSupportEvidence?.legLikePairCount ?? 0);
  if (pairCount >= 8 || Number(tpl?.rawTemplate?.defaults?.options?.doorCount ?? 0) >= 4) return [0.08, 0.38, 0.62, 0.92];
  return [0.12, 0.88];
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
  if (e.target.closest('[data-item]') || e.target.closest('[data-handle]') || e.target.closest('[data-corner]') || e.target.closest('[data-door-hinge]')) return;
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
      commitItemCandidate(item.id, { x: nx, y: ny });
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
      commitItemCandidate(item.id, { x: newX, w: newW });
    } else if (state.drag.mode === 'resize-r') {
      const dx = cur.x - state.drag.startX;
      let newW = state.drag.origW + dx;
      newW = snapStep(newW);
      const minW = OPT_DEFS[item.type].minW || 50;
      if (newW < minW) newW = minW;
      if (item.x + newW > state.cabinetW) newW = state.cabinetW - item.x;
      commitItemCandidate(item.id, { w: newW });
    }
    render();
  };
  const onUp = e => {
    state.drag = null;
    refreshPlacedList();
    syncWorkflowPanel();
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
      commitDimensionCandidate({ width: nW, height: nH });
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
  const asset = activeAsset();
  lines.push(`<div class="summary-grp">
    <h5>Drawing Asset</h5>
    <div class="summary-row"><span class="lbl">도면명</span><span class="val">${escapeHtml(asset?.title ?? workflowEls.title?.value.trim() ?? defaultAssetTitle())}</span></div>
    <div class="summary-row"><span class="lbl">검토 상태</span><span class="val">${escapeHtml(REVIEW_STATUS[asset?.reviewStatus ?? state.reviewStatus] ?? '작성중')}</span></div>
    <div class="summary-row"><span class="lbl">댓글 수</span><span class="val">${escapeHtml((asset?.comments ?? state.comments ?? []).length)}</span></div>
  </div>`);
  lines.push(`<div class="summary-grp">
    <h5>Product</h5>
    <div class="summary-row"><span class="lbl">제품명</span><span class="val">${state.template ? escapeHtml(state.template.name) : '직접 그리기 (Custom)'}</span></div>
    <div class="summary-row"><span class="lbl">제품코드</span><span class="val">${state.template ? escapeHtml(state.template.code) : 'CUSTOM'}</span></div>
    ${state.template ? `<div class="summary-row"><span class="lbl">제품군</span><span class="val">${escapeHtml(state.template.family)}</span></div>` : ''}
    <div class="summary-row"><span class="lbl">치수 (W × H × D)</span><span class="val">${state.cabinetW} × ${state.cabinetH} × ${state.cabinetD} mm</span></div>
    ${state.template ? `<div class="summary-row"><span class="lbl">DWG 근거</span><span class="val">${escapeHtml(state.template.dwgExtractionStatus)} · entity ${escapeHtml(state.template.entityCount)} · dim ${escapeHtml(state.template.dimensionCount)}</span></div>` : ''}
    ${state.template?.sourceFiles?.dwg ? `<div class="summary-row"><span class="lbl">샘플 DWG</span><span class="val">${escapeHtml(state.template.sourceFiles.dwg)}</span></div>` : ''}
  </div>`);

  lines.push(`<div class="summary-grp"><h5>Finish Colors</h5>
    <div class="summary-row"><span class="lbl">외부 색상</span><span class="val">${escapeHtml(colorLabel('exterior'))}</span></div>
    <div class="summary-row"><span class="lbl">내부 색상</span><span class="val">${escapeHtml(colorLabel('interior'))}</span></div>
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

  if (hingedDoorCount()) {
    lines.push(`<div class="summary-grp"><h5>Door Hinges</h5>`);
    ensureHingeConfig();
    state.hingeConfig.doors.forEach((door, index) => {
      lines.push(`<div class="summary-row">
        <span class="lbl">${index + 1}. ${index + 1}번 도어</span>
        <span class="val">${door.side === 'left' ? '좌경첩' : '우경첩'} · 상부 ${Math.round(door.top)}mm · 하부 ${Math.round(door.bottom)}mm · needs_review</span>
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
  const validation = validateDrawingState();
  lines.push(`<div class="summary-grp">
    <h5>Validation</h5>
    <div class="summary-row"><span class="lbl">상태</span><span class="val">${validation.valid ? '유효 · 저장 가능' : '차단 · 수정 필요'}</span></div>
    ${validation.errors.map(error => `<div class="summary-row"><span class="lbl">제한</span><span class="val">${escapeHtml(error)}</span></div>`).join('')}
  </div>`);

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
  const asset = activeAsset();
  let txt = '[도면 관리 자산]\n';
  txt += `도면명: ${asset?.title ?? workflowEls.title?.value.trim() ?? defaultAssetTitle()}\n`;
  txt += `검토 상태: ${REVIEW_STATUS[asset?.reviewStatus ?? state.reviewStatus] ?? '작성중'}\n`;
  txt += `제품: ${state.template ? state.template.name + ' (' + state.template.code + ')' : '직접 그리기 (CUSTOM)'}\n`;
  if (state.template) txt += `제품군: ${state.template.family}\n`;
  txt += `치수: ${state.cabinetW} × ${state.cabinetH} × ${state.cabinetD} mm\n`;
  if (state.template?.sourceFiles?.dwg) txt += `샘플 DWG: ${state.template.sourceFiles.dwg}\n`;
  if (state.template?.dwgExtractionStatus) txt += `DWG 근거: ${state.template.dwgExtractionStatus}, entity ${state.template.entityCount}, dim ${state.template.dimensionCount}\n`;
  txt += `외부 색상: ${colorLabel('exterior')}\n`;
  txt += `내부 색상: ${colorLabel('interior')}\n`;
  if (state.items.length) {
    txt += `\n[옵션]\n`;
    state.items.forEach((it, idx) => {
      const def = OPT_DEFS[it.type];
      const sizeStr = it.type === 'shelf' ? `${Math.round(it.w)}mm` : `${Math.round(it.w)}×${Math.round(it.h)}mm`;
      txt += `${idx+1}. ${def.name} - 위치(${Math.round(it.x)},${Math.round(it.y)}), 크기 ${sizeStr}\n`;
    });
  }
  if (hingedDoorCount()) {
    ensureHingeConfig();
    txt += `\n[도어 경첩]\n`;
    state.hingeConfig.doors.forEach((door, idx) => {
      txt += `${idx + 1}. ${idx + 1}번 도어 - ${door.side === 'left' ? '좌경첩' : '우경첩'}, 상부 ${Math.round(door.top)}mm, 하부 ${Math.round(door.bottom)}mm (needs_review)\n`;
    });
  }
  if (state.led) txt += `\nLED: ${LED_NAMES[state.led]}\n`;
  const comments = asset?.comments ?? state.comments ?? [];
  if (comments.length) {
    txt += `\n[댓글/피드백]\n`;
    comments.forEach((comment, idx) => {
      txt += `${idx + 1}. ${comment.author}: ${comment.text}\n`;
    });
  }
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
loadDwgSampleTemplates().catch(error => {
  console.error('Failed to preload DWG sample templates', error);
});
hydrateAssets();
showScreen('home');
