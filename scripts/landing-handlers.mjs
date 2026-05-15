import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomInt } from 'node:crypto';

/** @typedef {{ userId: string; username: string; role: string; token?: string }} AuthCtx */

export const LANDING_STYLE_IDS = ['hero-split', 'card-stack', 'minimal-center'];

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
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=120' });
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
    const order = [...LANDING_STYLE_IDS].sort(() => randomInt(0, 3) - 1);
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
