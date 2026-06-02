import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWED_DRAWING_ITEM_TYPES } from '../src/workflow.js';

const defaultRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const defaultDataDir = process.env.DATA_DIR || resolve(defaultRoot, '.data');
const port = Number(process.env.PORT || 4173);

const contentTypes = {
  '.html': 'text/html;charset=utf-8',
  '.css': 'text/css;charset=utf-8',
  '.js': 'application/javascript;charset=utf-8',
  '.json': 'application/json;charset=utf-8',
};

const reviewStatuses = new Set(['draft', 'in_review', 'approved', 'rejected']);
const roles = new Set(['sales', 'admin']);
const drawingItemTypes = new Set(ALLOWED_DRAWING_ITEM_TYPES);
// MVP role boundary: the current product brief keeps roles simple. The server
// still enforces sales/admin workflow transitions, but authentication is future work.

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json;charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

function text(response, status, message) {
  response.writeHead(status, {
    'content-type': 'text/plain;charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(message);
}

function parseUrlPath(requestUrl = '/') {
  try {
    const url = new URL(requestUrl, 'http://cabione.local');
    return decodeURIComponent(url.pathname);
  } catch (_error) {
    return null;
  }
}

export function isAllowedStaticPath(pathname) {
  if (pathname === '/' || pathname === '/index.html') return true;
  if (pathname === '/src/main.js' || pathname === '/src/workflow.js' || pathname === '/src/styles.css') return true;
  if (pathname === '/src/data/templateManifest.json') return true;
  return /^\/src\/data\/templates\/[^/]+\.json$/.test(pathname);
}

export function resolveStaticPath(pathname, rootDir = defaultRoot) {
  if (!pathname || !isAllowedStaticPath(pathname)) return null;
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (relativePath.split('/').some(part => part.startsWith('.'))) return null;
  const filePath = resolve(rootDir, relativePath);
  if (filePath !== rootDir && !filePath.startsWith(`${rootDir}${sep}`)) return null;
  return filePath;
}

function sanitizeText(value, max = 4000) {
  return String(value ?? '').trim().slice(0, max);
}

function sanitizeId(value, prefix = 'asset') {
  const textValue = sanitizeText(value, 120).replace(/[^\w:-]/g, '-');
  return textValue || `${prefix}-${Date.now()}`;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeDrawing(drawing) {
  if (!isPlainObject(drawing)) return null;
  const dimensions = drawing.dimensions ?? {};
  const width = Number(dimensions.width);
  const height = Number(dimensions.height);
  const depth = Number(dimensions.depth ?? 300);
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(depth)) return null;
  if (width <= 0 || height <= 0 || depth <= 0) return null;
  const items = [];
  for (const item of Array.isArray(drawing.items) ? drawing.items.slice(0, 80) : []) {
    const type = sanitizeText(item?.type, 40);
    const x = Number(item?.x);
    const y = Number(item?.y);
    const w = Number(item?.w);
    const h = Number(item?.h);
    if (!drawingItemTypes.has(type)) return null;
    if (![x, y, w, h].every(Number.isFinite)) return null;
    if (w <= 0 || h <= 0) return null;
    items.push({
      id: sanitizeId(item?.id, 'item'),
      type,
      x,
      y,
      w,
      h,
    });
  }
  return {
    schemaVersion: 1,
    mode: drawing.mode === 'template' ? 'template' : 'custom',
    templateCode: sanitizeText(drawing.templateCode, 160) || null,
    templateName: sanitizeText(drawing.templateName, 160) || null,
    family: sanitizeText(drawing.family, 160) || null,
    dimensions: { width, height, depth },
    items,
    led: ['warm', 'neutral', 'day'].includes(drawing.led) ? drawing.led : null,
    finishColors: isPlainObject(drawing.finishColors) ? drawing.finishColors : {},
    hingeConfig: isPlainObject(drawing.hingeConfig) ? drawing.hingeConfig : { selectedDoor: 1, doors: [] },
  };
}

function sanitizeComment(comment) {
  const role = roles.has(comment?.role) ? comment.role : 'sales';
  return {
    id: sanitizeId(comment?.id, 'comment'),
    role,
    author: sanitizeText(comment?.author, 80) || (role === 'admin' ? '관리자' : '영업 사원'),
    text: sanitizeText(comment?.text),
    createdAt: sanitizeText(comment?.createdAt, 40) || new Date().toISOString(),
    system: Boolean(comment?.system),
  };
}

function sanitizeAsset(asset) {
  const drawing = sanitizeDrawing(asset?.drawing);
  if (!drawing) return null;
  return {
    id: sanitizeId(asset?.id, 'drawing'),
    title: sanitizeText(asset?.title, 160) || '제목 없는 도면',
    reviewStatus: reviewStatuses.has(asset?.reviewStatus) ? asset.reviewStatus : 'draft',
    createdAt: sanitizeText(asset?.createdAt, 40) || new Date().toISOString(),
    updatedAt: sanitizeText(asset?.updatedAt, 40) || new Date().toISOString(),
    sharedAt: asset?.sharedAt ? sanitizeText(asset.sharedAt, 40) : null,
    createdBy: roles.has(asset?.createdBy) ? asset.createdBy : 'sales',
    drawing,
    comments: Array.isArray(asset?.comments) ? asset.comments.slice(0, 200).map(sanitizeComment) : [],
  };
}

async function readJsonBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw Object.assign(new Error('Payload too large'), { status: 413 });
  }
  try {
    return body ? JSON.parse(body) : {};
  } catch (_error) {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

async function readAssets(dataDir = defaultDataDir) {
  try {
    const raw = await readFile(resolve(dataDir, 'assets.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.assets) ? parsed.assets.map(sanitizeAsset).filter(Boolean) : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeAssets(assets, dataDir = defaultDataDir) {
  await mkdir(dataDir, { recursive: true });
  const filePath = resolve(dataDir, 'assets.json');
  const tempPath = resolve(dataDir, `assets.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, JSON.stringify({ schemaVersion: 1, assets }, null, 2));
  await rename(tempPath, filePath);
}

function upsert(assets, asset) {
  const index = assets.findIndex(entry => entry.id === asset.id);
  if (index >= 0) assets[index] = asset;
  else assets.unshift(asset);
  return assets;
}

function sameDrawing(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

async function handleAssets(request, response, dataDir) {
  if (request.method === 'GET') {
    return json(response, 200, { assets: await readAssets(dataDir) });
  }
  if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed' });

  const payload = await readJsonBody(request);
  const role = roles.has(payload.role) ? payload.role : null;
  const action = payload.action === 'share' ? 'share' : 'save';
  if (role !== 'sales') return json(response, 403, { error: 'Only sales can save or share drawing assets.' });

  const submitted = sanitizeAsset(payload.asset);
  if (!submitted) return json(response, 400, { error: 'Invalid drawing asset.' });

  const assets = await readAssets(dataDir);
  const existing = assets.find(asset => asset.id === submitted.id);
  const now = new Date().toISOString();
  const drawingChanged = existing ? !sameDrawing(existing.drawing, submitted.drawing) : false;
  const titleChanged = existing ? existing.title !== submitted.title : false;
  const reviewedStatusChanged = (drawingChanged || titleChanged) && ['approved', 'rejected'].includes(existing?.reviewStatus);
  const comments = existing?.comments ?? submitted.comments;
  const nextAsset = {
    ...submitted,
    createdAt: existing?.createdAt ?? submitted.createdAt ?? now,
    updatedAt: now,
    sharedAt: action === 'share' ? now : existing?.sharedAt ?? submitted.sharedAt ?? null,
    createdBy: existing?.createdBy ?? 'sales',
    reviewStatus: action === 'share' ? 'in_review' : reviewedStatusChanged ? 'draft' : existing?.reviewStatus ?? 'draft',
    comments: reviewedStatusChanged
      ? [...comments, sanitizeComment({
          id: `comment-${Date.now()}`,
          role: 'sales',
          author: '영업 사원',
          text: action === 'share'
            ? '검토 완료 후 도면이 수정되어 검토중으로 다시 공유되었습니다.'
            : '검토 완료 후 도면이 수정되어 상태가 작성중으로 변경되었습니다.',
          createdAt: now,
          system: true,
        })]
      : comments,
  };
  upsert(assets, nextAsset);
  await writeAssets(assets, dataDir);
  return json(response, 200, { asset: nextAsset, assets });
}

async function handleAssetComment(request, response, pathname, dataDir) {
  const match = pathname.match(/^\/api\/assets\/([^/]+)\/comments$/);
  if (!match) return false;
  if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed' });
  const payload = await readJsonBody(request);
  const role = roles.has(payload.role) ? payload.role : null;
  if (!role) return json(response, 403, { error: 'Unknown role.' });
  const textValue = sanitizeText(payload.text);
  if (!textValue) return json(response, 400, { error: 'Comment text is required.' });
  const assets = await readAssets(dataDir);
  const asset = assets.find(entry => entry.id === match[1]);
  if (!asset) return json(response, 404, { error: 'Asset not found.' });
  const now = new Date().toISOString();
  asset.updatedAt = now;
  asset.comments = [...asset.comments, sanitizeComment({
    id: `comment-${Date.now()}`,
    role,
    author: role === 'admin' ? '관리자' : '영업 사원',
    text: textValue,
    createdAt: now,
  })];
  await writeAssets(assets, dataDir);
  return json(response, 200, { asset, assets });
}

async function handleAssetDecision(request, response, pathname, dataDir) {
  const match = pathname.match(/^\/api\/assets\/([^/]+)\/decision$/);
  if (!match) return false;
  if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed' });
  const payload = await readJsonBody(request);
  if (payload.role !== 'admin') return json(response, 403, { error: 'Only admins can decide review status.' });
  if (!['approved', 'rejected'].includes(payload.reviewStatus)) return json(response, 400, { error: 'Invalid review decision.' });
  const assets = await readAssets(dataDir);
  const asset = assets.find(entry => entry.id === match[1]);
  if (!asset) return json(response, 404, { error: 'Asset not found.' });
  if (asset.reviewStatus !== 'in_review') return json(response, 409, { error: 'Only in-review drawings can be approved or rejected.' });
  const now = new Date().toISOString();
  asset.reviewStatus = payload.reviewStatus;
  asset.updatedAt = now;
  asset.comments = [...asset.comments, sanitizeComment({
    id: `comment-${Date.now()}`,
    role: 'admin',
    author: '관리자',
    text: payload.reviewStatus === 'approved' ? '관리자가 도면을 승인했습니다.' : '관리자가 도면을 반려했습니다.',
    createdAt: now,
    system: true,
  })];
  await writeAssets(assets, dataDir);
  return json(response, 200, { asset, assets });
}

async function handleApi(request, response, pathname, dataDir) {
  if (pathname === '/api/assets') return handleAssets(request, response, dataDir);
  const commentHandled = await handleAssetComment(request, response, pathname, dataDir);
  if (commentHandled !== false) return commentHandled;
  const decisionHandled = await handleAssetDecision(request, response, pathname, dataDir);
  if (decisionHandled !== false) return decisionHandled;
  return json(response, 404, { error: 'API route not found.' });
}

export function createCabioneServer({ rootDir = defaultRoot, dataDir = defaultDataDir } = {}) {
  const normalizedRoot = resolve(rootDir);
  const normalizedData = resolve(dataDir);
  return createServer(async (request, response) => {
    const pathname = parseUrlPath(request.url || '/');
    if (!pathname) return text(response, 400, 'Bad request');
    try {
      if (pathname.startsWith('/api/')) return await handleApi(request, response, pathname, normalizedData);
      const filePath = resolveStaticPath(pathname, normalizedRoot);
      if (!filePath) return text(response, 404, 'Not found');
      const info = await stat(filePath);
      response.writeHead(200, {
        'content-type': contentTypes[extname(filePath)] || 'application/octet-stream',
        'content-length': info.size,
        'cache-control': 'no-store',
      });
      return createReadStream(filePath).pipe(response);
    } catch (error) {
      if (error.status) return json(response, error.status, { error: error.message });
      return json(response, 500, { error: 'Server error' });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createCabioneServer().listen(port, '0.0.0.0', () => {
    console.log(`Cabione static server listening on ${port}`);
  });
}
