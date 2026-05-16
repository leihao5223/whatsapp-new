import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, normalize, resolve, dirname, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomInt, randomBytes } from 'node:crypto';
import busboy from 'busboy';
import { unzipSync } from 'fflate';

/** @typedef {{ userId: string; username: string; role: string; token?: string }} AuthCtx */

export const LANDING_STYLE_IDS = ['premium-scroll', 'hero-split', 'card-stack', 'minimal-center'];

const MAX_HISTORY = 50;

const sanitizeUserId = (userId) => String(userId ?? '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown';

const getLandingRoot = (projectRoot) =>
  (process.env.QE_LANDING_DATA_DIR && String(process.env.QE_LANDING_DATA_DIR).trim()) ||
  join(projectRoot, '.cache', 'landing');

const userJsonPath = (root, userId) => join(root, `${sanitizeUserId(userId)}.json`);

const userLogoPath = (root, userId) => join(root, sanitizeUserId(userId), 'logo.png');

const defaultLimits = () =>
  Object.fromEntries(LANDING_STYLE_IDS.map((id) => [id, 100]));

const defaultUsed = () => Object.fromEntries(LANDING_STYLE_IDS.map((id) => [id, 0]));

const defaultDoc = (userId) => ({
  version: 1,
  userId,
  updatedAt: new Date().toISOString(),
  profile: {
    projectName: '',
    companyType: '',
    buttonType: 'site',
    appDownloadUrl: '',
    serviceUrl: '',
    siteUrl: '',
    hasLogo: false,
  },
  settings: {
    pdfPresentation: false,
    randomStyle: true,
    lockTemplateId: '',
    usePlaceholderImages: false,
    domainsText: '',
    styleSendLimits: defaultLimits(),
  },
  runtime: {
    currentTemplateId: 'gallery-aurora',
    historyStack: [{ styleId: LANDING_STYLE_IDS[0], seed: randomInt(1, 1e9) }],
    historyIndex: 0,
    styleSendUsed: defaultUsed(),
  },
  customTemplates: [],
});

const parseDomains = (text) => {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const re = /^(\*\.)?[\w.-]+\.[a-zA-Z]{2,}$/;
  const ok = [];
  const bad = [];
  for (const line of lines) {
    if (re.test(line)) {
      ok.push(line);
    } else {
      bad.push(line);
    }
  }
  return { ok, bad };
};

const mergeLimits = (incoming) => {
  const base = defaultLimits();
  if (!incoming || typeof incoming !== 'object') {
    return base;
  }
  for (const id of LANDING_STYLE_IDS) {
    const n = Number.parseInt(String(incoming[id] ?? ''), 10);
    if (Number.isFinite(n) && n >= 0) {
      base[id] = Math.min(1_000_000, n);
    }
  }
  return base;
};

const mergeUsed = (incoming) => {
  const base = defaultUsed();
  if (!incoming || typeof incoming !== 'object') {
    return base;
  }
  for (const id of LANDING_STYLE_IDS) {
    const n = Number.parseInt(String(incoming[id] ?? ''), 10);
    if (Number.isFinite(n) && n >= 0) {
      base[id] = Math.min(1_000_000, n);
    }
  }
  return base;
};

const ensureRuntimeShape = (doc) => {
  if (!doc.runtime) {
    doc.runtime = defaultDoc(doc.userId).runtime;
  }
  const { runtime } = doc;
  if (!Array.isArray(runtime.historyStack) || !runtime.historyStack.length) {
    runtime.historyStack = [{ styleId: LANDING_STYLE_IDS[0], seed: randomInt(1, 1e9) }];
    runtime.historyIndex = 0;
  }
  if (!Number.isFinite(runtime.historyIndex) || runtime.historyIndex < 0) {
    runtime.historyIndex = 0;
  }
  if (runtime.historyIndex >= runtime.historyStack.length) {
    runtime.historyIndex = runtime.historyStack.length - 1;
  }
  runtime.styleSendUsed = mergeUsed(runtime.styleSendUsed);
  if (!runtime.currentTemplateId) {
    runtime.currentTemplateId = 'gallery-aurora';
  }
  if (!Array.isArray(doc.customTemplates)) {
    doc.customTemplates = [];
  }
};

const loadDoc = async (root, userId) => {
  const p = userJsonPath(root, userId);
  if (!existsSync(p)) {
    return defaultDoc(userId);
  }
  try {
    const raw = await readFile(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return defaultDoc(userId);
    }
    parsed.userId = userId;
    ensureRuntimeShape(parsed);
    if (!parsed.profile) {
      parsed.profile = defaultDoc(userId).profile;
    }
    if (!parsed.settings) {
      parsed.settings = defaultDoc(userId).settings;
    }
    parsed.settings.styleSendLimits = mergeLimits(parsed.settings.styleSendLimits);
    parsed.runtime.styleSendUsed = mergeUsed(parsed.runtime.styleSendUsed);
    return parsed;
  } catch {
    return defaultDoc(userId);
  }
};

const saveDoc = async (root, doc) => {
  doc.updatedAt = new Date().toISOString();
  const p = userJsonPath(root, doc.userId);
  await mkdir(root, { recursive: true });
  await writeFile(p, JSON.stringify(doc, null, 2), 'utf8');
};

const pickNextStyleId = (doc) => {
  const lock = String(doc.settings.lockTemplateId ?? '').trim();
  if (lock && LANDING_STYLE_IDS.includes(lock)) {
    return lock;
  }
  if (!doc.settings.randomStyle) {
    const cur = doc.runtime.historyStack[doc.runtime.historyIndex]?.styleId ?? LANDING_STYLE_IDS[0];
    const idx = LANDING_STYLE_IDS.indexOf(cur);
    const next = LANDING_STYLE_IDS[(idx + 1) % LANDING_STYLE_IDS.length];
    return next;
  }
  const cur = doc.runtime.historyStack[doc.runtime.historyIndex]?.styleId;
  const pool = LANDING_STYLE_IDS.filter((id) => id !== cur);
  const choices = pool.length ? pool : LANDING_STYLE_IDS;
  return choices[randomInt(0, choices.length)];
};

const pushHistory = (doc, styleId, seed) => {
  const { runtime } = doc;
  const base = runtime.historyStack.slice(0, runtime.historyIndex + 1);
  base.push({ styleId, seed });
  while (base.length > MAX_HISTORY) {
    base.shift();
  }
  runtime.historyStack = base;
  runtime.historyIndex = base.length - 1;
};

const currentFrame = (doc) => doc.runtime.historyStack[doc.runtime.historyIndex];

const pickRandomDomain = (domains) => {
  if (!domains.length) {
    return '';
  }
  const line = domains[randomInt(0, domains.length)];
  if (line.startsWith('*.')) {
    const parent = line.slice(2);
    const sub = `p${randomInt(10000, 99999)}`;
    return `${sub}.${parent}`;
  }
  return line;
};

const MAX_ZIP_BYTES = 26 * 1024 * 1024;
const MAX_UNZIP_TOTAL = 36 * 1024 * 1024;
const MAX_USER_TEMPLATES = 24;
const ALLOWED_ZIP_EXT = new Set([
  '.html',
  '.htm',
  '.css',
  '.js',
  '.mjs',
  '.json',
  '.map',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.svg',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.txt',
  '.md',
  '.xml',
  '.webmanifest',
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sanitizeTemplateId = (id) => String(id ?? '').replace(/[^a-zA-Z0-9_-]/g, '') || '';

const newTemplateId = () => `utpl_${randomBytes(8).toString('hex')}`;

const userTemplateBase = (root, userId, templateId) =>
  join(root, sanitizeUserId(userId), 'templates', sanitizeTemplateId(templateId));

const safeZipRel = (raw) => {
  const decoded = decodeURIComponent(String(raw ?? ''));
  const n = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '');
  if (n.includes('..')) {
    return null;
  }
  return n.replace(/^[\\/]+/, '');
};

const guessMime = (name) => {
  const lower = String(name).toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    return 'text/html; charset=utf-8';
  }
  if (lower.endsWith('.css')) {
    return 'text/css; charset=utf-8';
  }
  if (lower.endsWith('.js') || lower.endsWith('.mjs')) {
    return 'text/javascript; charset=utf-8';
  }
  if (lower.endsWith('.json')) {
    return 'application/json; charset=utf-8';
  }
  if (lower.endsWith('.png')) {
    return 'image/png';
  }
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (lower.endsWith('.webp')) {
    return 'image/webp';
  }
  if (lower.endsWith('.gif')) {
    return 'image/gif';
  }
  if (lower.endsWith('.svg')) {
    return 'image/svg+xml';
  }
  if (lower.endsWith('.ico')) {
    return 'image/x-icon';
  }
  if (lower.endsWith('.woff2')) {
    return 'font/woff2';
  }
  if (lower.endsWith('.woff')) {
    return 'font/woff';
  }
  if (lower.endsWith('.ttf')) {
    return 'font/ttf';
  }
  if (lower.endsWith('.txt') || lower.endsWith('.md')) {
    return 'text/plain; charset=utf-8';
  }
  return 'application/octet-stream';
};

const validateRemoteUrl = (raw) => {
  let u;
  try {
    u = new URL(String(raw ?? '').trim());
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(u.protocol)) {
    return null;
  }
  if (!u.host) {
    return null;
  }
  return u.href;
};

const pickHtmlEntry = (names) => {
  const norm = names.map((n) => String(n).replace(/\\/g, '/'));
  const indexCandidates = norm.filter((n) => /(^|\/)index\.html$/i.test(n));
  if (indexCandidates.length) {
    indexCandidates.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
    return indexCandidates[0];
  }
  const htmls = norm.filter((n) => /\.html?$/i.test(n));
  htmls.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  return htmls[0] ?? null;
};

const unzipLandingZip = (buf) => {
  let out;
  try {
    out = unzipSync(buf);
  } catch (e) {
    throw new Error(`ZIP 解压失败（可能为加密或损坏）：${String(e?.message ?? e)}`);
  }
  let total = 0;
  /** @type {Record<string, Buffer>} */
  const files = {};
  for (const [rel, data] of Object.entries(out)) {
    const relPosix = rel.replace(/\\/g, '/');
    if (relPosix.endsWith('/')) {
      continue;
    }
    if (relPosix.startsWith('__MACOSX/') || relPosix.includes('/__MACOSX/')) {
      continue;
    }
    const base = relPosix.split('/').pop() ?? '';
    if (base.startsWith('._')) {
      continue;
    }
    const ext = base.includes('.') ? `.${base.split('.').pop()?.toLowerCase() ?? ''}` : '';
    if (!ALLOWED_ZIP_EXT.has(ext) && !/\.html?$/i.test(base)) {
      continue;
    }
    if (relPosix.includes('..')) {
      continue;
    }
    total += data.byteLength;
    if (total > MAX_UNZIP_TOTAL) {
      throw new Error('ZIP expands too large');
    }
    files[relPosix] = Buffer.from(data);
  }
  if (!Object.keys(files).length) {
    throw new Error('No usable files in ZIP (need HTML/CSS/JS/assets)');
  }
  return files;
};

const readZipMultipart = (req) =>
  new Promise((resolve, reject) => {
    const bb = busboy({ headers: req.headers, limits: { fileSize: MAX_ZIP_BYTES, fields: 32 } });
    let displayName = 'ZIP 模板';
    let fileSeen = false;
    let settled = false;
    const finish = (err, data) => {
      if (settled) {
        return;
      }
      settled = true;
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    };

    bb.on('field', (name, val) => {
      if (name === 'name') {
        displayName = String(val).trim().slice(0, 80) || displayName;
      }
    });

    bb.on('file', (fieldname, file) => {
      if (fieldname !== 'file') {
        file.resume();
        return;
      }
      fileSeen = true;
      const chunks = [];
      file.on('data', (d) => chunks.push(d));
      file.on('limit', () => finish(new Error('ZIP 超过大小限制（最大约 26MB）')));
      file.on('error', (e) => finish(e));
      file.on('end', () => {
        const zipBuf = Buffer.concat(chunks);
        if (zipBuf.length < 22) {
          finish(new Error('ZIP 文件为空或过短'));
          return;
        }
        finish(null, { zipBuf, displayName });
      });
    });

    bb.on('error', (e) => finish(e));
    bb.on('finish', () => {
      queueMicrotask(() => {
        if (!settled && !fileSeen) {
          finish(new Error('未收到 ZIP 文件：请确认表单字段名为 file，且 Content-Type 为 multipart/form-data'));
        }
      });
    });

    req.pipe(bb);
  });

/**
 * @param {object} ctx
 * @returns {Promise<boolean>}
 */
async function matchLandingTemplateRoutes({ req, res, pathname, method, root, effectiveUserId, sendJson, readBody }) {
  if (!pathname.startsWith('/landing/templates')) {
    return false;
  }

  const coverMatch = pathname.match(/^\/landing\/templates\/([^/]+)\/cover\.png$/);
  if (method === 'GET' && coverMatch) {
    const tid = sanitizeTemplateId(coverMatch[1]);
    if (!tid.startsWith('utpl_')) {
      sendJson(res, 404, { success: false, error: 'Not found' });
      return true;
    }
    const doc = await loadDoc(root, effectiveUserId);
    const meta = (doc.customTemplates || []).find((t) => t.id === tid);
    if (!meta) {
      sendJson(res, 404, { success: false, error: 'Template not found' });
      return true;
    }
    const p = join(userTemplateBase(root, effectiveUserId, tid), 'cover.png');
    if (!existsSync(p)) {
      sendJson(res, 404, { success: false, error: 'No cover yet' });
      return true;
    }
    const buf = await readFile(p);
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=120' });
    res.end(buf);
    return true;
  }

  const filesMatch = pathname.match(/^\/landing\/templates\/([^/]+)\/files\/(.*)$/);
  if (method === 'GET' && filesMatch) {
    const tid = sanitizeTemplateId(filesMatch[1]);
    const relRaw = filesMatch[2] ?? '';
    const rel = safeZipRel(relRaw);
    if (!tid.startsWith('utpl_') || !rel) {
      sendJson(res, 400, { success: false, error: 'Bad path' });
      return true;
    }
    const doc = await loadDoc(root, effectiveUserId);
    const meta = (doc.customTemplates || []).find((t) => t.id === tid);
    if (!meta || meta.source !== 'zip') {
      sendJson(res, 404, { success: false, error: 'Template not found' });
      return true;
    }
    const baseResolved = resolve(userTemplateBase(root, effectiveUserId, tid));
    const absResolved = resolve(join(baseResolved, rel));
    const relToBase = relative(baseResolved, absResolved);
    if (!relToBase || relToBase.startsWith('..') || relToBase.split(/[/\\]/).includes('..')) {
      sendJson(res, 403, { success: false, error: 'Forbidden path' });
      return true;
    }
    if (!existsSync(absResolved)) {
      sendJson(res, 404, { success: false, error: 'File not found' });
      return true;
    }
    const buf = await readFile(absResolved);
    res.writeHead(200, { 'Content-Type': guessMime(rel), 'Cache-Control': 'private, max-age=120' });
    res.end(buf);
    return true;
  }

  if (method === 'POST' && pathname === '/landing/templates/from-zip') {
    let zipBuf;
    let displayName;
    try {
      ({ zipBuf, displayName } = await readZipMultipart(req));
    } catch (e) {
      sendJson(res, 400, { success: false, error: String(e?.message ?? e) });
      return true;
    }
    const sig = zipBuf.subarray(0, 4).toString('hex');
    if (sig !== '504b0304' && sig !== '504b0506' && sig !== '504b0708') {
      sendJson(res, 400, { success: false, error: 'Not a ZIP file' });
      return true;
    }
    /** @type {Record<string, Buffer>} */
    let extracted;
    try {
      extracted = unzipLandingZip(zipBuf);
    } catch (e) {
      sendJson(res, 400, { success: false, error: String(e?.message ?? e) });
      return true;
    }
    const entry = pickHtmlEntry(Object.keys(extracted));
    if (!entry) {
      sendJson(res, 400, { success: false, error: 'No HTML entry in ZIP' });
      return true;
    }
    const doc = await loadDoc(root, effectiveUserId);
    if ((doc.customTemplates || []).length >= MAX_USER_TEMPLATES) {
      sendJson(res, 400, { success: false, error: `Each user can have at most ${MAX_USER_TEMPLATES} custom templates` });
      return true;
    }
    const id = newTemplateId();
    const dir = userTemplateBase(root, effectiveUserId, id);
    await mkdir(dir, { recursive: true });
    for (const [rel, data] of Object.entries(extracted)) {
      const dest = join(dir, rel);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, data);
    }
    doc.customTemplates = [...(doc.customTemplates || []), { id, name: displayName, source: 'zip', entry, coverCaptured: false }];
    doc.runtime.currentTemplateId = id;
    await saveDoc(root, doc);
    sendJson(res, 200, { success: true, data: { doc, templateId: id } });
    return true;
  }

  if (method === 'POST' && pathname === '/landing/templates/from-url') {
    const body = JSON.parse((await readBody(req)) || '{}');
    const name = String(body.name ?? '链接模板').trim().slice(0, 80) || '链接模板';
    const urlOk = validateRemoteUrl(body.url);
    if (!urlOk) {
      sendJson(res, 400, { success: false, error: 'Invalid http(s) URL' });
      return true;
    }
    const doc = await loadDoc(root, effectiveUserId);
    if ((doc.customTemplates || []).length >= MAX_USER_TEMPLATES) {
      sendJson(res, 400, { success: false, error: `Each user can have at most ${MAX_USER_TEMPLATES} custom templates` });
      return true;
    }
    const id = newTemplateId();
    doc.customTemplates = [
      ...(doc.customTemplates || []),
      { id, name, source: 'url', remoteUrl: urlOk, entry: '', coverCaptured: false },
    ];
    doc.runtime.currentTemplateId = id;
    await saveDoc(root, doc);
    sendJson(res, 200, { success: true, data: { doc, templateId: id } });
    return true;
  }

  const captureMatch = pathname.match(/^\/landing\/templates\/([^/]+)\/capture$/);
  if (method === 'POST' && captureMatch) {
    const tid = sanitizeTemplateId(captureMatch[1]);
    if (!tid.startsWith('utpl_')) {
      sendJson(res, 400, { success: false, error: 'Bad template id' });
      return true;
    }
    const doc = await loadDoc(root, effectiveUserId);
    const idx = (doc.customTemplates || []).findIndex((t) => t.id === tid);
    if (idx < 0) {
      sendJson(res, 404, { success: false, error: 'Template not found' });
      return true;
    }
    const meta = doc.customTemplates[idx];
    if (meta.coverCaptured && existsSync(join(userTemplateBase(root, effectiveUserId, tid), 'cover.png'))) {
      sendJson(res, 200, { success: true, data: { doc, skipped: true } });
      return true;
    }
    const outPng = join(userTemplateBase(root, effectiveUserId, tid), 'cover.png');
    /** @type {import('playwright').Browser | undefined} */
    let browser;
    try {
      const { chromium } = await import('playwright');
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 390, height: 720 } });
      let target = '';
      if (meta.source === 'url' && meta.remoteUrl) {
        target = meta.remoteUrl;
      } else if (meta.source === 'zip' && meta.entry) {
        const baseDir = resolve(userTemplateBase(root, effectiveUserId, tid));
        const absHtml = resolve(join(baseDir, meta.entry));
        const relCheck = relative(baseDir, absHtml);
        if (!relCheck || relCheck.startsWith('..') || relCheck.split(/[/\\]/).includes('..')) {
          throw new Error('Bad entry path');
        }
        target = pathToFileURL(absHtml).href;
      } else {
        throw new Error('Template has no preview target');
      }
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await sleep(1600);
      await page.screenshot({ path: outPng, type: 'png', fullPage: false });
    } catch (e) {
      sendJson(res, 500, { success: false, error: `Screenshot failed: ${String(e?.message ?? e)}` });
      return true;
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch {
          /* ignore */
        }
      }
    }
    doc.customTemplates[idx].coverCaptured = true;
    await saveDoc(root, doc);
    const fresh = await loadDoc(root, effectiveUserId);
    sendJson(res, 200, { success: true, data: { doc: fresh } });
    return true;
  }

  const deleteMatch = pathname.match(/^\/landing\/templates\/([^/]+)$/);
  if (method === 'DELETE' && deleteMatch) {
    const tid = sanitizeTemplateId(deleteMatch[1]);
    if (!tid.startsWith('utpl_')) {
      sendJson(res, 400, { success: false, error: 'Bad template id' });
      return true;
    }
    const doc = await loadDoc(root, effectiveUserId);
    const before = (doc.customTemplates || []).length;
    doc.customTemplates = (doc.customTemplates || []).filter((t) => t.id !== tid);
    if (doc.customTemplates.length === before) {
      sendJson(res, 404, { success: false, error: 'Template not found' });
      return true;
    }
    if (doc.runtime.currentTemplateId === tid) {
      doc.runtime.currentTemplateId = 'gallery-aurora';
    }
    const dir = userTemplateBase(root, effectiveUserId, tid);
    if (existsSync(dir)) {
      await rm(dir, { recursive: true, force: true });
    }
    await saveDoc(root, doc);
    sendJson(res, 200, { success: true, data: { doc } });
    return true;
  }

  return false;
}

/**
 * @param {object} opts
 * @param {import('node:http').IncomingMessage} opts.req
 * @param {import('node:http').ServerResponse} opts.res
 * @param {string} opts.pathname
 * @param {string} opts.method
 * @param {(req: import('node:http').IncomingMessage) => Promise<string>} opts.readBody
 * @param {(res: import('node:http').ServerResponse, status: number, body: object) => void} opts.sendJson
 * @param {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, options?: object) => AuthCtx | null} opts.requireBatchAuth
 * @param {string} opts.projectRoot
 * @returns {Promise<boolean>}
 */
export async function handleLandingRequest({ req, res, pathname, method, readBody, sendJson, requireBatchAuth, projectRoot }) {
  const root = getLandingRoot(projectRoot);

  if (pathname.startsWith('/admin/landing')) {
    const auth = requireBatchAuth(req, res, { roles: ['super_admin'] });
    if (!auth) {
      return true;
    }
    if (method === 'GET' && pathname === '/admin/landing/list') {
      await mkdir(root, { recursive: true });
      const files = await readdir(root).catch(() => []);
      const users = files.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
      sendJson(res, 200, { success: true, users });
      return true;
    }
    const profileMatch = pathname.match(/^\/admin\/landing\/([^/]+)\/profile$/);
    if (method === 'GET' && profileMatch) {
      const targetId = profileMatch[1];
      const doc = await loadDoc(root, targetId);
      sendJson(res, 200, { success: true, profile: doc });
      return true;
    }
    const logoMatch = pathname.match(/^\/admin\/landing\/([^/]+)\/logo$/);
    if (method === 'GET' && logoMatch) {
      const targetId = logoMatch[1];
      const lp = userLogoPath(root, targetId);
      if (!existsSync(lp)) {
        sendJson(res, 404, { success: false, error: 'Logo not found' });
        return true;
      }
      const buf = await readFile(lp);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=60' });
      res.end(buf);
      return true;
    }
    sendJson(res, 404, { success: false, error: 'Not found' });
    return true;
  }

  if (!pathname.startsWith('/landing/')) {
    return false;
  }

  const auth = requireBatchAuth(req, res, { roles: ['super_admin', 'sub_user'] });
  if (!auth) {
    return true;
  }

  const effectiveUserId = auth.userId;

  if (await matchLandingTemplateRoutes({ req, res, pathname, method, root, effectiveUserId, sendJson, readBody })) {
    return true;
  }

  if (method === 'GET' && pathname === '/landing/profile') {
    const doc = await loadDoc(root, effectiveUserId);
    sendJson(res, 200, { success: true, data: doc });
    return true;
  }

  if (method === 'PUT' && pathname === '/landing/profile') {
    const body = JSON.parse((await readBody(req)) || '{}');
    const doc = await loadDoc(root, effectiveUserId);
    if (typeof body.projectName === 'string') {
      doc.profile.projectName = body.projectName.slice(0, 200);
    }
    if (typeof body.companyType === 'string') {
      doc.profile.companyType = body.companyType.slice(0, 200);
    }
    if (['app', 'service', 'site'].includes(String(body.buttonType))) {
      doc.profile.buttonType = body.buttonType;
    }
    if (typeof body.appDownloadUrl === 'string') {
      doc.profile.appDownloadUrl = body.appDownloadUrl.slice(0, 2000);
    }
    if (typeof body.serviceUrl === 'string') {
      doc.profile.serviceUrl = body.serviceUrl.slice(0, 2000);
    }
    if (typeof body.siteUrl === 'string') {
      doc.profile.siteUrl = body.siteUrl.slice(0, 2000);
    }
    if (typeof body.currentTemplateId === 'string') {
      doc.runtime.currentTemplateId = body.currentTemplateId.slice(0, 120);
    }
    if (typeof body.logoPngBase64 === 'string' && body.logoPngBase64.length > 20) {
      const b64 = body.logoPngBase64.replace(/^data:image\/png;base64,/, '');
      let buf;
      try {
        buf = Buffer.from(b64, 'base64');
      } catch {
        sendJson(res, 400, { success: false, error: 'Invalid logo base64' });
        return true;
      }
      if (buf.length < 8) {
        sendJson(res, 400, { success: false, error: 'Logo 解码失败，请使用有效 PNG 文件' });
        return true;
      }
      const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      if (Buffer.compare(buf.subarray(0, 8), pngSig) !== 0) {
        sendJson(res, 400, { success: false, error: 'Logo 须为标准 PNG 图片（文件头校验未通过）' });
        return true;
      }
      if (buf.length > 2_500_000) {
        sendJson(res, 400, { success: false, error: 'Logo too large' });
        return true;
      }
      const dir = join(root, sanitizeUserId(effectiveUserId));
      await mkdir(dir, { recursive: true });
      const lp = userLogoPath(root, effectiveUserId);
      await writeFile(lp, buf);
      doc.profile.hasLogo = true;
    }
    await saveDoc(root, doc);
    sendJson(res, 200, { success: true, data: doc });
    return true;
  }

  if (method === 'GET' && pathname === '/landing/settings') {
    const doc = await loadDoc(root, effectiveUserId);
    sendJson(res, 200, { success: true, data: doc.settings, updatedAt: doc.updatedAt });
    return true;
  }

  if (method === 'PUT' && pathname === '/landing/settings') {
    const body = JSON.parse((await readBody(req)) || '{}');
    const doc = await loadDoc(root, effectiveUserId);
    if (typeof body.pdfPresentation === 'boolean') {
      doc.settings.pdfPresentation = body.pdfPresentation;
    }
    if (typeof body.randomStyle === 'boolean') {
      doc.settings.randomStyle = body.randomStyle;
    }
    if (typeof body.lockTemplateId === 'string') {
      doc.settings.lockTemplateId = body.lockTemplateId.slice(0, 120);
    }
    if (typeof body.usePlaceholderImages === 'boolean') {
      doc.settings.usePlaceholderImages = body.usePlaceholderImages;
    }
    if (typeof body.domainsText === 'string') {
      doc.settings.domainsText = body.domainsText.slice(0, 20000);
    }
    if (body.styleSendLimits && typeof body.styleSendLimits === 'object') {
      doc.settings.styleSendLimits = mergeLimits(body.styleSendLimits);
    }
    await saveDoc(root, doc);
    sendJson(res, 200, { success: true, data: doc });
    return true;
  }

  if (method === 'POST' && pathname === '/landing/layout/next') {
    const doc = await loadDoc(root, effectiveUserId);
    const styleId = pickNextStyleId(doc);
    const seed = randomInt(1, 1e9);
    pushHistory(doc, styleId, seed);
    await saveDoc(root, doc);
    sendJson(res, 200, { success: true, data: { frame: currentFrame(doc), doc } });
    return true;
  }

  if (method === 'POST' && pathname === '/landing/layout/prev') {
    const doc = await loadDoc(root, effectiveUserId);
    if (doc.runtime.historyIndex > 0) {
      doc.runtime.historyIndex -= 1;
    }
    await saveDoc(root, doc);
    sendJson(res, 200, { success: true, data: { frame: currentFrame(doc), doc } });
    return true;
  }

  if (method === 'GET' && pathname === '/landing/assets/logo') {
    const lp = userLogoPath(root, effectiveUserId);
    if (!existsSync(lp)) {
      sendJson(res, 404, { success: false, error: 'No logo' });
      return true;
    }
    const buf = await readFile(lp);
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, no-store, must-revalidate',
    });
    res.end(buf);
    return true;
  }

  if (method === 'POST' && pathname === '/landing/send/simulate') {
    const body = JSON.parse((await readBody(req)) || '{}');
    const doc = await loadDoc(root, effectiveUserId);
    const styleId = LANDING_STYLE_IDS.includes(String(body.styleId)) ? body.styleId : currentFrame(doc).styleId;
    const limit = doc.settings.styleSendLimits[styleId] ?? 0;
    const used = doc.runtime.styleSendUsed[styleId] ?? 0;
    if (used >= limit) {
      sendJson(res, 409, { success: false, error: 'Style send limit reached', styleId, used, limit });
      return true;
    }
    doc.runtime.styleSendUsed[styleId] = used + 1;
    await saveDoc(root, doc);
    sendJson(res, 200, { success: true, styleId, used: used + 1, limit });
    return true;
  }

  if (method === 'POST' && pathname === '/landing/send/next') {
    const doc = await loadDoc(root, effectiveUserId);
    const { ok } = parseDomains(doc.settings.domainsText);
    const order = [...LANDING_STYLE_IDS];
    for (let i = order.length - 1; i > 0; i--) {
      const j = randomInt(0, i);
      [order[i], order[j]] = [order[j], order[i]];
    }
    let picked = '';
    for (const sid of order) {
      const limit = doc.settings.styleSendLimits[sid] ?? 0;
      const used = doc.runtime.styleSendUsed[sid] ?? 0;
      if (used < limit) {
        picked = sid;
        break;
      }
    }
    if (!picked) {
      sendJson(res, 409, { success: false, error: 'No style capacity left' });
      return true;
    }
    doc.runtime.styleSendUsed[picked] = (doc.runtime.styleSendUsed[picked] ?? 0) + 1;
    const host = pickRandomDomain(ok);
    const virtualUrl = host ? `https://${host}/` : '';
    await saveDoc(root, doc);
    sendJson(res, 200, {
      success: true,
      styleId: picked,
      virtualUrl,
      hostSuggested: host,
      used: doc.runtime.styleSendUsed[picked],
      limit: doc.settings.styleSendLimits[picked],
      remainingByStyle: Object.fromEntries(
        LANDING_STYLE_IDS.map((id) => [id, Math.max(0, (doc.settings.styleSendLimits[id] ?? 0) - (doc.runtime.styleSendUsed[id] ?? 0))]),
      ),
      frame: currentFrame(doc),
      note: '群发服务应调用本接口获取分配结果；virtualUrl 为根据域名仓库拼接的建议链接，需自行部署 HTML 到对应主机。',
    });
    return true;
  }

  sendJson(res, 404, { success: false, error: 'Landing route not found' });
  return true;
}
