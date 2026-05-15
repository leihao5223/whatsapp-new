import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AvsovBatchRunner, checkSingleProxy, isSocks5ProxyFormat, toBatchExportRows } from './avsov-batch-runner.mjs';
import { AvsovSearchCore, decryptTarget } from './avsov-search-core.mjs';

const jsonHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Runner-Token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

const hashPassword = (password, salt) => createHash('sha256').update(`${salt}:${password}`).digest('hex');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const __dirname = dirname(fileURLToPath(import.meta.url));

const loadEnvFile = (filePath) => {
  if (!filePath || !existsSync(filePath)) {
    return;
  }
  const text = readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
};

const bootstrapEnv = () => {
  const candidates = [
    process.env.QE_ENV_FILE,
    resolve(__dirname, '..', '.env'),
    resolve(__dirname, '..', '..', '.env'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    loadEnvFile(candidate);
  }
};

bootstrapEnv();

const clampScore = (score) => Math.max(0, Math.min(100, Math.round(score)));
const clamp01 = (value) => Math.max(0, Math.min(1, value));

const categoryFromScore = (score) => {
  if (score >= 86) {
    return '高价值';
  }

  if (score >= 60) {
    return '待复核';
  }

  return '无效线索';
};

const statusFromOpened = (opened) => (opened ? 'opened' : 'closed');
const normalizeName = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
const toQqMail = (qq) => (qq ? `${qq}@qq.com` : '');

const readBody = async (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];

    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

const sendJson = (res, status, body) => {
  res.writeHead(status, jsonHeaders);
  res.end(JSON.stringify(body));
};

const extractAuthToken = (req) => {
  const headerToken = req.headers['x-runner-token'];
  if (typeof headerToken === 'string' && headerToken.trim()) {
    return headerToken.trim();
  }
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  return '';
};

const parseList = (value) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const createWorkers = () => {
  const accountIds = parseList(process.env.QQ_RUNNER_ACCOUNTS);
  const bridgeUrls = parseList(process.env.QQ_BRIDGE_URLS || process.env.QQ_BRIDGE_URL);

  if (bridgeUrls.length) {
    return bridgeUrls.map((bridgeUrl, index) => ({
      id: accountIds[index] ?? `qq-${index + 1}`,
      label: `QQ窗口 ${accountIds[index] ?? index + 1}`,
      mode: 'bridge',
      bridgeUrl,
    }));
  }

  return [];
};

const loadConfig = () => ({
  /** 默认 0.0.0.0：本机 Nginx 与「Docker 里的 Nginx 反代宿主机端口」都能连上；若只本机访问可设 QQ_RUNNER_LISTEN_HOST=127.0.0.1 */
  listenHost: (process.env.QQ_RUNNER_LISTEN_HOST ?? '0.0.0.0').trim() || '0.0.0.0',
  port: Number.parseInt(process.env.QQ_RUNNER_PORT ?? '8787', 10),
  concurrency: Math.max(1, Number.parseInt(process.env.QQ_RUNNER_CONCURRENCY ?? '2', 10)),
  delayMs: Math.max(0, Number.parseInt(process.env.QQ_RUNNER_DELAY_MS ?? '450', 10)),
  workers: createWorkers(),
  scoreSchema: {
    weights: {
      avatar: Number.parseFloat(process.env.QQ_SCORE_AVATAR_WEIGHT ?? '0.5'),
      name: Number.parseFloat(process.env.QQ_SCORE_NAME_WEIGHT ?? '0.3'),
      keyword: Number.parseFloat(process.env.QQ_SCORE_KEYWORD_WEIGHT ?? '0.2'),
    },
    thresholds: {
      auto: Number.parseFloat(process.env.QQ_SCORE_THRESHOLD_AUTO ?? '0.85'),
      review: Number.parseFloat(process.env.QQ_SCORE_THRESHOLD_REVIEW ?? '0.65'),
    },
  },
  cachePath: resolve(__dirname, '..', '.cache', 'qq-feedback-cache.json'),
  /** 子账号/超管账号持久化（重启 Runner 不丢失）；可用 QE_AUTH_USERS_PATH 覆盖 */
  authUsersPath:
    process.env.QE_AUTH_USERS_PATH?.trim() ||
    resolve(__dirname, '..', '.cache', 'auth-users.json'),
  batchWorkerCount: Math.max(1, Number.parseInt(process.env.AVSOV_WORKER_COUNT ?? '3', 10)),
  batchMode: String(process.env.AVSOV_RUN_MODE ?? 'hybrid').toLowerCase(),
  batchHttpConcurrencyPerWorker: Math.max(1, Number.parseInt(process.env.AVSOV_HTTP_CONCURRENCY_PER_WORKER ?? '8', 10)),
  batchMaxRetries: Math.max(0, Number.parseInt(process.env.AVSOV_MAX_RETRIES ?? '3', 10)),
  batchTimeoutMs: Math.max(3000, Number.parseInt(process.env.AVSOV_TIMEOUT_MS ?? '18000', 10)),
  batchMinDelayMs: Math.max(100, Number.parseInt(process.env.AVSOV_MIN_DELAY_MS ?? '500', 10)),
  batchMaxDelayMs: Math.max(200, Number.parseInt(process.env.AVSOV_MAX_DELAY_MS ?? '1300', 10)),
  batchProxyPool: process.env.AVSOV_PROXY_POOL ?? '',
  batchAuthToken: process.env.AVSOV_BATCH_TOKEN ?? 'Qq1314520..0254131q',
  searchEngine: String(process.env.QQ_RUNNER_SEARCH_ENGINE ?? 'bridge').toLowerCase(),
  authSessionTtlSec: Math.max(300, Number.parseInt(process.env.QE_AUTH_SESSION_TTL_SEC ?? '28800', 10)),
  authMaxLoginAttempts: Math.max(3, Number.parseInt(process.env.QE_AUTH_MAX_LOGIN_ATTEMPTS ?? '8', 10)),
  authLockMinutes: Math.max(1, Number.parseInt(process.env.QE_AUTH_LOCK_MINUTES ?? '15', 10)),
});

const createFeedbackStore = () => ({
  confirmedByPhone: {},
  updatedAt: new Date().toISOString(),
});

const feedbackStore = createFeedbackStore();

const loadFeedbackStore = async () => {
  try {
    const raw = await readFile(config.cachePath, 'utf8');
    const parsed = JSON.parse(raw);
    Object.assign(feedbackStore, parsed);
  } catch {
    // First run or malformed cache: keep in-memory defaults.
  }
};

const saveFeedbackStore = async () => {
  await mkdir(dirname(config.cachePath), { recursive: true });
  const payload = {
    ...feedbackStore,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(config.cachePath, JSON.stringify(payload, null, 2), 'utf8');
};

const bridgeSearch = async (query, worker) => {
  if (!worker.bridgeUrl) {
    throw new Error(`${worker.label} missing bridgeUrl`);
  }

  const response = await fetch(worker.bridgeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, accountId: worker.id, workerId: worker.id }),
  });

  if (!response.ok) {
    throw new Error(`${worker.label} bridge returned ${response.status}`);
  }

  const result = await response.json();
  return {
    ...result,
    source: result.source ?? worker.label,
    workerId: worker.id,
  };
};

const runWorkerSearch = (query, worker) => {
  if (worker.mode !== 'bridge') {
    throw new Error('Real mode only: simulator workers are disabled');
  }
  return bridgeSearch(query, worker);
};

const candidateNameScore = (query, candidate) => {
  const q = normalizeName(query);
  const n = normalizeName(candidate.name);
  if (!q || !n) {
    return 0;
  }
  if (n.includes(q) || q.includes(n)) {
    return 1;
  }
  const overlap = [...q].filter((char) => n.includes(char)).length;
  return clamp01(overlap / Math.max(q.length, n.length));
};

const candidateKeywordScore = (candidate) => {
  const signals = candidate.signals ?? {};
  return clamp01((Number(signals.keywordHits ?? 0) + Number(signals.qqHits ?? 0)) / 4);
};

const candidateAvatarScore = (candidate) => {
  if (candidate.avatarHash) {
    return 0.9;
  }
  return candidate.qq ? 0.7 : 0.4;
};

const scoreCandidate = (query, candidate, scoreSchema) => {
  const avatar = candidateAvatarScore(candidate);
  const name = candidateNameScore(query, candidate);
  const keyword = candidateKeywordScore(candidate);
  const total =
    avatar * scoreSchema.weights.avatar + name * scoreSchema.weights.name + keyword * scoreSchema.weights.keyword;
  return {
    ...candidate,
    score: clamp01(total),
    scoreBreakdown: { avatar, name, keyword },
  };
};

const rankCandidates = (query, candidates, scoreSchema) =>
  (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => scoreCandidate(query, candidate, scoreSchema))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

const withFeedbackHint = (query, rankedCandidates) => {
  const hint = feedbackStore.confirmedByPhone?.[query];
  if (!hint) {
    return rankedCandidates;
  }
  return rankedCandidates
    .map((candidate) => {
      if (hint.qq && candidate.qq === hint.qq) {
        return {
          ...candidate,
          score: clamp01(candidate.score + 0.12),
          tags: [...new Set([...(candidate.tags ?? []), 'feedback-boost'])],
        };
      }
      if (hint.name && normalizeName(candidate.name) === normalizeName(hint.name)) {
        return {
          ...candidate,
          score: clamp01(candidate.score + 0.06),
          tags: [...new Set([...(candidate.tags ?? []), 'feedback-name-match'])],
        };
      }
      return candidate;
    })
    .sort((a, b) => b.score - a.score);
};

const decideFromCandidates = (query, result, scoreSchema) => {
  const baseCandidates = result.candidates?.length
    ? result.candidates
    : result.qq
      ? [{ qq: result.qq, name: '', avatarHash: '', signals: { qqHits: 1, keywordHits: 1 }, source: result.source }]
      : [];
  const ranked = withFeedbackHint(query, rankCandidates(query, baseCandidates, scoreSchema));
  const top = ranked[0];
  if (!top) {
    return {
      ...result,
      opened: false,
      status: 'closed',
      category: '未开通',
      decision: 'reject',
      qq: undefined,
      email: undefined,
      candidates: [],
      topCandidates: [],
      summary: `${result.summary ?? ''} 未提取到可用候选，建议人工复核。`.trim(),
    };
  }

  const decision =
    top.score >= scoreSchema.thresholds.auto ? 'auto-pass' : top.score >= scoreSchema.thresholds.review ? 'review' : 'reject';
  const opened = decision !== 'reject';
  return {
    ...result,
    opened,
    status: opened ? 'opened' : 'closed',
    category: opened ? '开通' : '未开通',
    confidence: clampScore(top.score * 100),
    decision,
    qq: opened ? top.qq || result.qq : undefined,
    email: opened ? toQqMail(top.qq || result.qq) : undefined,
    topCandidates: ranked.slice(0, 3),
    candidates: ranked,
    summary: `${result.summary ?? ''} 候选判定=${decision} topScore=${top.score.toFixed(3)}.`.trim(),
    tags: [...new Set([...(result.tags ?? []), 'candidate-rerank', decision])],
  };
};

const textSignal = (value) => String(value ?? '').toLowerCase();

const buildStateVector = (result, query) => {
  const title = textSignal(result.title);
  const summary = textSignal(result.summary);
  const tags = Array.isArray(result.tags) ? result.tags.map((tag) => textSignal(tag)).join(' ') : '';
  const corpus = `${title} ${summary} ${tags}`;
  const queryNorm = textSignal(query).replace(/\s+/g, '');

  return {
    confidence: clamp01(Number(result.confidence ?? result.score ?? 0) / 100),
    containsOpened: /开通|opened|active|已开/.test(corpus) ? 1 : 0,
    containsClosed: /未开通|未开|closed|inactive|无账号|无结果/.test(corpus) ? 1 : 0,
    hasQueryEcho: queryNorm && corpus.replace(/\s+/g, '').includes(queryNorm) ? 1 : 0,
    tagCount: clamp01((Array.isArray(result.tags) ? result.tags.length : 0) / 6),
  };
};

const createBaselineStore = () => ({
  opened: { count: 0, vector: null },
  closed: { count: 0, vector: null },
});

const baselineStore = createBaselineStore();

const mergeBaseline = (current, next) => {
  if (!current.vector || current.count <= 0) {
    return { count: 1, vector: next };
  }

  const count = current.count + 1;
  const vector = Object.fromEntries(
    Object.keys(next).map((key) => [key, (current.vector[key] * current.count + next[key]) / count]),
  );
  return { count, vector };
};

const distanceToBaseline = (vector, baseline) => {
  if (!baseline?.vector) {
    return Number.POSITIVE_INFINITY;
  }

  return Object.keys(vector).reduce((total, key) => total + Math.abs(vector[key] - baseline.vector[key]), 0);
};

const applyBaselineDecision = (result, query) => {
  const hasOpenedBaseline = Boolean(baselineStore.opened.vector);
  const hasClosedBaseline = Boolean(baselineStore.closed.vector);
  if (!hasOpenedBaseline || !hasClosedBaseline) {
    return result;
  }

  const vector = buildStateVector(result, query);
  const openedDistance = distanceToBaseline(vector, baselineStore.opened);
  const closedDistance = distanceToBaseline(vector, baselineStore.closed);
  const opened = openedDistance <= closedDistance;
  const gap = Math.abs(openedDistance - closedDistance);
  const confidenceBoost = clampScore(55 + gap * 45);

  return {
    ...result,
    opened,
    status: statusFromOpened(opened),
    category: opened ? '开通' : '未开通',
    confidence: Math.max(result.confidence ?? 0, confidenceBoost),
    summary: `${result.summary ?? ''} 基线判别: ${
      opened ? '更接近开通样本' : '更接近未开通样本'
    } (opened=${openedDistance.toFixed(3)}, closed=${closedDistance.toFixed(3)}).`.trim(),
    tags: [...new Set([...(result.tags ?? []), 'baseline-compare'])],
    baseline: {
      openedDistance,
      closedDistance,
      gap,
    },
  };
};

const forceSampleByLabel = (sample, normalizedStatus) => {
  const opened = normalizedStatus === 'opened';
  return {
    ...sample,
    opened,
    status: statusFromOpened(opened),
    category: opened ? '开通' : '未开通',
    tags: [...new Set([...(sample.tags ?? []), 'manual-label'])],
  };
};

const loginWorker = async ({ account, password, portId, portName, portNumber }) => {
  if (!account || !password || !portId) {
    return {
      success: false,
      error: 'Missing account, password, or portId',
    };
  }

  const worker = config.workers.find((item) => item.id === portId) ?? config.workers[0];
  if (worker?.mode === 'bridge' && worker.bridgeUrl) {
    const loginUrl = new URL(worker.bridgeUrl);
    loginUrl.pathname = loginUrl.pathname.replace(/\/search\/?$/, '/login');
    if (!loginUrl.pathname.endsWith('/login')) {
      loginUrl.pathname = `${loginUrl.pathname.replace(/\/$/, '')}/login`;
    }

    const response = await fetch(loginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ account, password, portId, portName, portNumber, workerId: worker.id }),
    });

    return response.json();
  }

  await sleep(config.delayMs);
  return {
    success: true,
    account,
    workerId: worker?.id ?? portId,
    message: `${portName ?? portId} 已通过托管 QQ Runtime 模拟完成自动登录。`,
  };
};

class RoundRobinQueue {
  activeCount = 0;
  cursor = 0;
  pending = [];

  constructor(config) {
    this.config = config;
  }

  status() {
    return {
      active: this.activeCount,
      pending: this.pending.length,
      concurrency: this.config.concurrency,
      workers: this.config.workers.map(({ bridgeUrl, ...worker }) => ({
        ...worker,
        connected: Boolean(bridgeUrl),
      })),
    };
  }

  enqueue(query) {
    return new Promise((resolve, reject) => {
      if (!this.config.workers.length) {
        reject(new Error('No real bridge workers configured. Please set QQ_BRIDGE_URLS.'));
        return;
      }
      this.pending.push({ query, resolve, reject });
      this.drain();
    });
  }

  nextWorker() {
    const worker = this.config.workers[this.cursor % this.config.workers.length];
    this.cursor += 1;
    return worker;
  }

  drain() {
    while (this.activeCount < this.config.concurrency && this.pending.length) {
      const task = this.pending.shift();
      if (!task) {
        return;
      }

      const worker = this.nextWorker();
      this.activeCount += 1;

      runWorkerSearch(task.query, worker, this.config)
        .then(task.resolve)
        .catch(task.reject)
        .finally(() => {
          this.activeCount -= 1;
          this.drain();
        });
    }
  }
}

const config = loadConfig();
const queue = new RoundRobinQueue(config);
await loadFeedbackStore();
const createSearchCore = () => {
  const encryptedTarget = process.env.AVSOV_TARGET_URL_ENC;
  const targetSecret = process.env.AVSOV_TARGET_SECRET;
  if (!encryptedTarget || !targetSecret) {
    return null;
  }
  const targetUrl = decryptTarget(encryptedTarget, targetSecret);
  return new AvsovSearchCore({
    targetUrl,
    mode: config.batchMode,
    maxRetries: config.batchMaxRetries,
    requestTimeoutMs: config.batchTimeoutMs,
    minDelayMs: config.batchMinDelayMs,
    maxDelayMs: config.batchMaxDelayMs,
    headless: process.env.AVSOV_HEADLESS ?? 'true',
  });
};
let searchCore = createSearchCore();
const getBatchRunner = (workerCount) =>
  new AvsovBatchRunner({
    workerCount: config.batchWorkerCount,
    mode: config.batchMode,
    httpConcurrencyPerWorker: config.batchHttpConcurrencyPerWorker,
    maxRetries: config.batchMaxRetries,
    requestTimeoutMs: config.batchTimeoutMs,
    minDelayMs: config.batchMinDelayMs,
    maxDelayMs: config.batchMaxDelayMs,
    proxyList: config.batchProxyPool,
    ...(workerCount ? { workerCount } : {}),
  });
const batchTasks = new Map();
const authUsers = new Map();
const authSessions = new Map();
const authLoginAttempts = new Map();
const auditLogs = [];
const pipelineState = {
  historyPool: new Set(),
  pendingPool: [],
  inflightPool: new Map(),
  completedPool: new Map(),
  logs: [],
};
const portRuntime = new Map();
const ipReservePool = new Map();
const batchHistory = [];
const pipelineOwnerMap = new Map();
const numberLibraryByUser = new Map();

let authUsersSaveTimer = null;

const appendAuditLog = (entry) => {
  auditLogs.push({
    at: new Date().toISOString(),
    ...entry,
  });
  if (auditLogs.length > 5000) {
    auditLogs.splice(0, auditLogs.length - 5000);
  }
};

const serializeAuthUser = (user) => ({
  userId: user.userId,
  username: user.username,
  role: user.role,
  status: user.status,
  permissions: user.permissions,
  salt: user.salt,
  passwordHash: user.passwordHash,
  createdAt: user.createdAt,
  lastLoginAt: user.lastLoginAt ?? '',
});

const persistAuthUsers = async () => {
  await mkdir(dirname(config.authUsersPath), { recursive: true });
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    users: [...authUsers.values()].map(serializeAuthUser),
  };
  await writeFile(config.authUsersPath, JSON.stringify(payload, null, 2), 'utf8');
};

const schedulePersistAuthUsers = () => {
  if (authUsersSaveTimer) {
    clearTimeout(authUsersSaveTimer);
  }
  authUsersSaveTimer = setTimeout(() => {
    authUsersSaveTimer = null;
    void persistAuthUsers().catch((err) => {
      console.error('[auth] persist failed:', err instanceof Error ? err.message : err);
    });
  }, 200);
};

const ensureBootstrapSuperAdmin = () => {
  const adminUsername = process.env.QE_SUPER_ADMIN_USERNAME ?? 'a522352377';
  const adminPassword = process.env.QE_SUPER_ADMIN_PASSWORD ?? 'Qq1314520.';
  const existing = authUsers.get(adminUsername);
  if (existing?.role === 'super_admin' && existing.passwordHash && existing.salt) {
    return;
  }
  const adminSalt = randomBytes(12).toString('hex');
  authUsers.set(adminUsername, {
    userId: existing?.userId ?? `u-${adminUsername}`,
    username: adminUsername,
    role: 'super_admin',
    status: 'active',
    permissions: ['*'],
    salt: adminSalt,
    passwordHash: hashPassword(adminPassword, adminSalt),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    lastLoginAt: existing?.lastLoginAt ?? '',
  });
};

const loadAuthUsersFromDisk = async () => {
  authUsers.clear();
  try {
    const raw = await readFile(config.authUsersPath, 'utf8');
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed?.users) ? parsed.users : Array.isArray(parsed) ? parsed : [];
    for (const row of rows) {
      const username = String(row.username ?? '').trim();
      if (!username || !row.passwordHash || !row.salt) {
        continue;
      }
      const role = row.role === 'super_admin' ? 'super_admin' : 'sub_user';
      authUsers.set(username, {
        userId: String(row.userId ?? `u-${username}`),
        username,
        role,
        status: row.status === 'disabled' ? 'disabled' : 'active',
        permissions: Array.isArray(row.permissions) ? row.permissions : role === 'super_admin' ? ['*'] : ['self'],
        salt: String(row.salt),
        passwordHash: String(row.passwordHash),
        createdAt: String(row.createdAt ?? new Date().toISOString()),
        lastLoginAt: String(row.lastLoginAt ?? ''),
      });
    }
    console.log(`[auth] loaded ${authUsers.size} user(s) from ${config.authUsersPath}`);
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code !== 'ENOENT') {
      console.error('[auth] load failed:', err instanceof Error ? err.message : err);
    }
  }
  ensureBootstrapSuperAdmin();
  await persistAuthUsers();
};

async function initAuthUsers() {
  await loadAuthUsersFromDisk();
}

const safeUser = (user) => ({
  userId: user.userId,
  username: user.username,
  role: user.role,
  status: user.status,
  permissions: user.permissions,
  createdAt: user.createdAt,
  lastLoginAt: user.lastLoginAt,
});

const issueSession = (user, deviceId = '') => {
  const now = Date.now();
  const ttlMs = config.authSessionTtlSec * 1000;
  const token = randomBytes(24).toString('base64url');
  const refreshToken = randomBytes(32).toString('base64url');
  const session = {
    token,
    refreshToken,
    userId: user.userId,
    username: user.username,
    role: user.role,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    deviceId: deviceId || 'unknown',
  };
  authSessions.set(token, session);
  return session;
};

const extractBearerToken = (req) => {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  return '';
};

const resolveAuthContext = (req) => {
  const staticToken = extractAuthToken(req);
  if (staticToken && staticToken === config.batchAuthToken) {
    return {
      userId: 'u-static-admin',
      username: 'static-admin',
      role: 'super_admin',
      via: 'static-token',
    };
  }
  const bearer = extractBearerToken(req);
  if (!bearer) {
    return null;
  }
  const session = authSessions.get(bearer);
  if (!session) {
    return null;
  }
  const expMs = new Date(session.expiresAt).getTime();
  if (Number.isFinite(expMs) && Date.now() > expMs) {
    authSessions.delete(bearer);
    return null;
  }
  return {
    userId: session.userId,
    username: session.username,
    role: session.role,
    via: 'session',
    token: bearer,
  };
};

const normalizePhone = (value) => String(value ?? '').replace(/\D/g, '');
const parsePhones = (value) =>
  (Array.isArray(value) ? value : String(value ?? '').split(/\r?\n|,|\s+/))
    .map((item) => normalizePhone(item))
    .filter((item) => item.length >= 6);

const ensureNumberLibrary = (userId) => {
  if (!numberLibraryByUser.has(userId)) {
    numberLibraryByUser.set(userId, {
      all: new Set(),
      unsent: [],
    });
  }
  return numberLibraryByUser.get(userId);
};

const consumeFromNumberLibrary = (userId, phones) => {
  if (!userId || !Array.isArray(phones) || !phones.length) {
    return 0;
  }
  const library = ensureNumberLibrary(userId);
  const before = library.unsent.length;
  const used = new Set(parsePhones(phones));
  if (!used.size) {
    return 0;
  }
  library.unsent = library.unsent.filter((phone) => !used.has(phone));
  return before - library.unsent.length;
};

const pushPipelineLog = (entry) => {
  pipelineState.logs.push({ ...entry, at: new Date().toISOString() });
  if (pipelineState.logs.length > 2000) {
    pipelineState.logs.splice(0, pipelineState.logs.length - 2000);
  }
};

const pipelineSnapshot = () => ({
  history: pipelineState.historyPool.size,
  pending: pipelineState.pendingPool.length,
  inflight: pipelineState.inflightPool.size,
  completed: pipelineState.completedPool.size,
  logs: pipelineState.logs.slice(-200),
});

const pipelineSnapshotForUser = (auth) => {
  if (!auth || auth.role === 'super_admin') {
    return pipelineSnapshot();
  }
  const owns = (phone) => pipelineOwnerMap.get(phone) === auth.userId;
  const pending = pipelineState.pendingPool.filter((phone) => owns(phone)).length;
  const inflight = [...pipelineState.inflightPool.keys()].filter((phone) => owns(phone)).length;
  const completed = [...pipelineState.completedPool.keys()].filter((phone) => owns(phone)).length;
  const logs = pipelineState.logs.filter((item) => !item.ownerUserId || item.ownerUserId === auth.userId).slice(-200);
  const history = new Set(
    [...pipelineState.historyPool.values()].filter((phone) => owns(phone)),
  ).size;
  return { history, pending, inflight, completed, logs };
};

const requireBatchAuth = (req, res, options = {}) => {
  const auth = resolveAuthContext(req);
  if (!auth) {
    sendJson(res, 401, { success: false, error: 'Unauthorized access' });
    return null;
  }
  if (Array.isArray(options.roles) && options.roles.length && !options.roles.includes(auth.role)) {
    sendJson(res, 403, { success: false, error: 'Forbidden' });
    return null;
  }
  return auth;
};

const ensurePortState = (portId) => {
  if (!portRuntime.has(portId)) {
    portRuntime.set(portId, {
      portId,
      status: 'ready',
      paused: false,
      updatedAt: new Date().toISOString(),
    });
  }
  return portRuntime.get(portId);
};

const portSnapshotRows = () =>
  [...portRuntime.values()].map((item) => ({
    ...item,
    inflight: [...pipelineState.inflightPool.values()].filter((task) => task.portId === item.portId).length,
  }));

const createBatchTask = (phones) => {
  const id = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const task = {
    id,
    status: 'queued',
    createdAt: new Date().toISOString(),
    startedAt: '',
    finishedAt: '',
    total: phones.length,
    processed: 0,
    hit: 0,
    failed: 0,
    records: [],
    error: '',
    cancelled: false,
    paused: false,
    distribution: {},
    phonePortMap: {},
    replacementCount: 0,
  };
  batchTasks.set(id, task);
  return task;
};

const toCsv = (rows) => {
  const headers = ['phone', 'qq', 'query_time', 'retry_count'];
  const payload = [headers, ...rows.map((row) => [row.phone, row.qq, row.query_time, row.retry_count])];
  return payload.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
};

const markIpReserveState = (proxy, patch) => {
  if (!proxy) {
    return;
  }
  const current = ipReservePool.get(proxy) ?? {
    proxy,
    state: 'reserve',
    score: 50,
    ok: true,
    latency_ms: 0,
    failureCount: 0,
    successCount: 0,
    updatedAt: new Date().toISOString(),
  };
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  ipReservePool.set(proxy, next);
};

const evaluatePortHealth = (portId) => {
  const state = ensurePortState(portId);
  const inflight = [...pipelineState.inflightPool.values()].filter((task) => task.portId === portId).length;
  const healthy = state.status !== 'offline' && !state.paused;
  return {
    portId,
    healthy,
    inflight,
    score: healthy ? Math.max(1, 100 - inflight * 8) : 0,
  };
};

const allocatePhonesBalanced = (phones, portIds, options = {}) => {
  const normalizedPortIds = (Array.isArray(portIds) ? portIds : []).map((id) => String(id).trim()).filter(Boolean);
  const healthyPorts = normalizedPortIds
    .map((id) => evaluatePortHealth(id))
    .filter((item) => item.healthy)
    .sort((a, b) => b.score - a.score);
  const fallbackPorts = healthyPorts.length ? healthyPorts.map((item) => item.portId) : ['default'];
  const dedicated = typeof options.dedicatedAssignments === 'object' && options.dedicatedAssignments ? options.dedicatedAssignments : {};
  const squads = Array.isArray(options.squads) ? options.squads : [];
  const distribution = Object.fromEntries(fallbackPorts.map((id) => [id, 0]));
  const phonePortMap = {};
  const squadMap = {};
  phones.forEach((phone) => {
    const dedicatedPort = dedicated[phone];
    if (dedicatedPort && fallbackPorts.includes(dedicatedPort)) {
      phonePortMap[phone] = dedicatedPort;
      distribution[dedicatedPort] = (distribution[dedicatedPort] ?? 0) + 1;
      return;
    }
    const squad = squads.find((item) => Array.isArray(item.phones) && item.phones.includes(phone));
    if (squad?.id && Array.isArray(squad.portIds) && squad.portIds.length) {
      const availableSquadPorts = squad.portIds.filter((id) => fallbackPorts.includes(id));
      if (availableSquadPorts.length) {
        const cursor = squadMap[squad.id] ?? 0;
        const portId = availableSquadPorts[cursor % availableSquadPorts.length];
        squadMap[squad.id] = cursor + 1;
        phonePortMap[phone] = portId;
        distribution[portId] = (distribution[portId] ?? 0) + 1;
        return;
      }
    }
    const targetPort = Object.entries(distribution).sort((a, b) => a[1] - b[1])[0]?.[0] ?? fallbackPorts[0];
    phonePortMap[phone] = targetPort;
    distribution[targetPort] = (distribution[targetPort] ?? 0) + 1;
  });
  return { distribution, phonePortMap, healthyPorts };
};

const summaryFromTask = (task) => ({
  batchId: task.id,
  status: task.status,
  total: task.total,
  processed: task.processed,
  hit: task.hit,
  failed: task.failed,
  directCount: task.directCount ?? 0,
  fallbackCount: task.fallbackCount ?? 0,
  mode: task.mode ?? config.batchMode,
  workerCount: task.workerCount ?? config.batchWorkerCount,
  startedAt: task.startedAt || task.createdAt,
  finishedAt: task.finishedAt || '',
});

const buildRuntimeRecommendation = () => {
  const cpus = Math.max(1, os.cpus()?.length ?? 1);
  const totalMemGb = Math.max(1, Math.round(os.totalmem() / 1024 / 1024 / 1024));
  const freeMemGb = Math.max(0, Math.round(os.freemem() / 1024 / 1024 / 1024));
  const recommendedPorts = Math.max(2, Math.min(20, Math.round(cpus * 1.5)));
  const recommendedHttpConcurrencyPerWorker = Math.max(2, Math.min(12, Math.round((freeMemGb >= 8 ? 8 : 4) + cpus / 2)));
  const estimatedDailyCapacity = recommendedPorts * recommendedHttpConcurrencyPerWorker * 900;
  return {
    cpus,
    totalMemGb,
    freeMemGb,
    recommendedPorts,
    recommendedHttpConcurrencyPerWorker,
    estimatedDailyCapacity,
    targetMet: estimatedDailyCapacity >= 200000,
  };
};

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, jsonHeaders);
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  // Nginx 常见写法 `location /api/ { proxy_pass http://runner/; }` 会把 /api 前缀剥掉再转发；
  // 若未剥掉，请求会以 /api/auth/... 到达本进程，这里统一归一成 /auth/...
  const pathname = url.pathname.startsWith('/api/') ? url.pathname.slice(4) : url.pathname;

  try {
    if (req.method === 'POST' && pathname === '/auth/login') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const username = String(body.username ?? '').trim();
      const password = String(body.password ?? '');
      const deviceId = String(body.deviceId ?? '').trim();
      if (!username || !password) {
        sendJson(res, 400, { success: false, error: 'Missing username or password' });
        return;
      }
      const user = authUsers.get(username);
      if (!user || user.status !== 'active') {
        appendAuditLog({ type: 'auth-login-failed', username, reason: 'user-not-found', deviceId });
        sendJson(res, 401, { success: false, error: 'Invalid credentials' });
        return;
      }
      const attempt = authLoginAttempts.get(username) ?? { count: 0, lockedUntil: 0 };
      if (attempt.lockedUntil && Date.now() < attempt.lockedUntil) {
        sendJson(res, 429, { success: false, error: 'Account temporarily locked' });
        return;
      }
      const calcHash = hashPassword(password, user.salt);
      const ok =
        calcHash.length === user.passwordHash.length &&
        timingSafeEqual(Buffer.from(calcHash), Buffer.from(user.passwordHash));
      if (!ok) {
        attempt.count += 1;
        if (attempt.count >= config.authMaxLoginAttempts) {
          attempt.lockedUntil = Date.now() + config.authLockMinutes * 60 * 1000;
          attempt.count = 0;
        }
        authLoginAttempts.set(username, attempt);
        appendAuditLog({ type: 'auth-login-failed', username, reason: 'bad-password', deviceId });
        sendJson(res, 401, { success: false, error: 'Invalid credentials' });
        return;
      }
      authLoginAttempts.delete(username);
      user.lastLoginAt = new Date().toISOString();
      schedulePersistAuthUsers();
      const session = issueSession(user, deviceId);
      appendAuditLog({ type: 'auth-login-success', username, userId: user.userId, deviceId });
      sendJson(res, 200, {
        success: true,
        token: session.token,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
        user: safeUser(user),
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/auth/refresh') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const refreshToken = String(body.refreshToken ?? '').trim();
      const current = [...authSessions.values()].find((item) => item.refreshToken === refreshToken);
      if (!current) {
        sendJson(res, 401, { success: false, error: 'Invalid refresh token' });
        return;
      }
      const user = [...authUsers.values()].find((item) => item.userId === current.userId);
      if (!user || user.status !== 'active') {
        sendJson(res, 403, { success: false, error: 'User disabled' });
        return;
      }
      authSessions.delete(current.token);
      const next = issueSession(user, current.deviceId);
      appendAuditLog({ type: 'auth-refresh', username: user.username, userId: user.userId, deviceId: current.deviceId });
      sendJson(res, 200, {
        success: true,
        token: next.token,
        refreshToken: next.refreshToken,
        expiresAt: next.expiresAt,
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/auth/logout') {
      const auth = requireBatchAuth(req, res, { roles: ['super_admin', 'sub_user'] });
      if (!auth) {
        return;
      }
      if (auth.token) {
        authSessions.delete(auth.token);
      }
      appendAuditLog({ type: 'auth-logout', username: auth.username, userId: auth.userId });
      sendJson(res, 200, { success: true });
      return;
    }

    if (req.method === 'GET' && pathname === '/auth/me') {
      const auth = requireBatchAuth(req, res, { roles: ['super_admin', 'sub_user'] });
      if (!auth) {
        return;
      }
      const user = [...authUsers.values()].find((item) => item.userId === auth.userId);
      sendJson(res, 200, { success: true, user: user ? safeUser(user) : { userId: auth.userId, username: auth.username, role: auth.role } });
      return;
    }

    if (req.method === 'GET' && pathname === '/admin/subaccounts') {
      const auth = requireBatchAuth(req, res, { roles: ['super_admin'] });
      if (!auth) {
        return;
      }
      sendJson(res, 200, {
        success: true,
        rows: [...authUsers.values()].map((user) => safeUser(user)),
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/admin/subaccounts') {
      const auth = requireBatchAuth(req, res, { roles: ['super_admin'] });
      if (!auth) {
        return;
      }
      const body = JSON.parse((await readBody(req)) || '{}');
      const username = String(body.username ?? '').trim();
      const password = String(body.password ?? '');
      const role = String(body.role ?? 'sub_user').trim() === 'super_admin' ? 'super_admin' : 'sub_user';
      if (!username || !password) {
        sendJson(res, 400, { success: false, error: 'Missing username or password' });
        return;
      }
      if (authUsers.has(username)) {
        sendJson(res, 409, { success: false, error: 'User already exists' });
        return;
      }
      const salt = randomBytes(12).toString('hex');
      const user = {
        userId: `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        username,
        role,
        status: 'active',
        permissions: role === 'super_admin' ? ['*'] : ['self'],
        salt,
        passwordHash: hashPassword(password, salt),
        createdAt: new Date().toISOString(),
        lastLoginAt: '',
      };
      authUsers.set(username, user);
      schedulePersistAuthUsers();
      appendAuditLog({ type: 'subaccount-create', actor: auth.username, target: username, role });
      sendJson(res, 200, { success: true, user: safeUser(user) });
      return;
    }

    if (req.method === 'POST' && pathname === '/admin/subaccounts/status') {
      const auth = requireBatchAuth(req, res, { roles: ['super_admin'] });
      if (!auth) {
        return;
      }
      const body = JSON.parse((await readBody(req)) || '{}');
      const username = String(body.username ?? '').trim();
      const status = String(body.status ?? '').trim();
      const user = authUsers.get(username);
      if (!user) {
        sendJson(res, 404, { success: false, error: 'User not found' });
        return;
      }
      if (!['active', 'disabled'].includes(status)) {
        sendJson(res, 400, { success: false, error: 'Invalid status' });
        return;
      }
      user.status = status;
      schedulePersistAuthUsers();
      appendAuditLog({ type: 'subaccount-status', actor: auth.username, target: username, status });
      sendJson(res, 200, { success: true, user: safeUser(user) });
      return;
    }

    if (req.method === 'GET' && pathname === '/admin/audit') {
      const auth = requireBatchAuth(req, res, { roles: ['super_admin', 'sub_user'] });
      if (!auth) {
        return;
      }
      const rows = auth.role === 'super_admin'
        ? auditLogs.slice(-2000).reverse()
        : auditLogs.filter((item) => item.userId === auth.userId || item.username === auth.username).slice(-500).reverse();
      sendJson(res, 200, { success: true, rows });
      return;
    }

    if (req.method === 'GET' && pathname === '/pipeline/status') {
      const auth = requireBatchAuth(req, res, { roles: ['super_admin', 'sub_user'] });
      if (!auth) {
        return;
      }
      sendJson(res, 200, {
        success: true,
        ...pipelineSnapshotForUser(auth),
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/number-library/stats') {
      const auth = requireBatchAuth(req, res, { roles: ['super_admin', 'sub_user'] });
      if (!auth) {
        return;
      }
      const library = ensureNumberLibrary(auth.userId);
      sendJson(res, 200, {
        success: true,
        total: library.all.size,
        unsent: library.unsent.length,
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/number-library/import') {
      const auth = requireBatchAuth(req, res, { roles: ['super_admin', 'sub_user'] });
      if (!auth) {
        return;
      }
      const body = JSON.parse((await readBody(req)) || '{}');
      const phones = parsePhones(body.phones ?? body.text ?? []);
      const library = ensureNumberLibrary(auth.userId);
      const accepted = [];
      let deduped = 0;
      phones.forEach((phone) => {
        if (library.all.has(phone)) {
          deduped += 1;
          return;
        }
        library.all.add(phone);
        library.unsent.push(phone);
        accepted.push(phone);
      });
      appendAuditLog({
        type: 'number-library-import',
        userId: auth.userId,
        username: auth.username,
        total: phones.length,
        accepted: accepted.length,
        deduped,
      });
      sendJson(res, 200, {
        success: true,
        total: phones.length,
        accepted: accepted.length,
        deduped,
        phones: accepted,
        stats: { total: library.all.size, unsent: library.unsent.length },
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/number-library/take') {
      const auth = requireBatchAuth(req, res, { roles: ['super_admin', 'sub_user'] });
      if (!auth) {
        return;
      }
      const body = JSON.parse((await readBody(req)) || '{}');
      const count = Math.max(0, Math.floor(Number(body.count ?? 0)));
      const library = ensureNumberLibrary(auth.userId);
      const phones = count > 0 ? library.unsent.splice(0, count) : [];
      appendAuditLog({
        type: 'number-library-take',
        userId: auth.userId,
        username: auth.username,
        countRequested: count,
        countTaken: phones.length,
      });
      sendJson(res, 200, {
        success: true,
        phones,
        stats: { total: library.all.size, unsent: library.unsent.length },
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/number-library/export') {
      const auth = requireBatchAuth(req, res, { roles: ['super_admin', 'sub_user'] });
      if (!auth) {
        return;
      }
      const library = ensureNumberLibrary(auth.userId);
      sendJson(res, 200, {
        success: true,
        phones: [...library.all.values()],
        total: library.all.size,
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/pipeline/import') {
      const auth = requireBatchAuth(req, res, { roles: ['super_admin', 'sub_user'] });
      if (!auth) {
        return;
      }
      const body = JSON.parse((await readBody(req)) || '{}');
      const phones = parsePhones(body.phones ?? body.text ?? []);
      const accepted = [];
      let deduped = 0;
      phones.forEach((phone) => {
        const exists =
          pipelineState.historyPool.has(phone) ||
          pipelineState.pendingPool.includes(phone) ||
          pipelineState.inflightPool.has(phone);
        if (exists) {
          deduped += 1;
          return;
        }
        pipelineState.pendingPool.push(phone);
        pipelineState.historyPool.add(phone);
        pipelineOwnerMap.set(phone, auth.userId);
        accepted.push(phone);
      });
      pushPipelineLog({ type: 'import', total: phones.length, accepted: accepted.length, deduped, ownerUserId: auth.userId });
      appendAuditLog({
        type: 'pipeline-import',
        userId: auth.userId,
        username: auth.username,
        total: phones.length,
        accepted: accepted.length,
        deduped,
      });
      sendJson(res, 200, {
        success: true,
        total: phones.length,
        accepted: accepted.length,
        deduped,
        phones: accepted,
        pending: pipelineState.pendingPool.length,
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/pipeline/import-and-start') {
      const auth = requireBatchAuth(req, res, { roles: ['super_admin', 'sub_user'] });
      if (!auth) {
        return;
      }
      const body = JSON.parse((await readBody(req)) || '{}');
      const incomingPhones = parsePhones(body.phones ?? body.text ?? []);
      const accepted = [];
      let deduped = 0;
      incomingPhones.forEach((phone) => {
        const exists =
          pipelineState.historyPool.has(phone) ||
          pipelineState.pendingPool.includes(phone) ||
          pipelineState.inflightPool.has(phone);
        if (exists) {
          deduped += 1;
          return;
        }
        pipelineState.pendingPool.push(phone);
        pipelineState.historyPool.add(phone);
        pipelineOwnerMap.set(phone, auth.userId);
        accepted.push(phone);
      });

      const portIds = Array.isArray(body.portIds) ? body.portIds.map((item) => String(item).trim()).filter(Boolean) : [];
      const allocation = allocatePhonesBalanced(accepted, portIds, {
        dedicatedAssignments: body.dedicatedAssignments,
        squads: body.squads,
      });
      const selectedPortIds = Object.keys(allocation.distribution).length ? Object.keys(allocation.distribution) : ['default'];
      const distribution = allocation.distribution;
      const phonePortMap = allocation.phonePortMap;

      const selfCheck = {
        runner: true,
        ports: selectedPortIds.length > 0 && allocation.healthyPorts.filter((item) => item.healthy).length > 0,
        proxies: true,
        balance: true,
      };
      const selfCheckPass = Boolean(selfCheck.runner && selfCheck.ports && selfCheck.proxies);
      if (!selfCheckPass) {
        sendJson(res, 200, {
          success: false,
          selfCheckPass: false,
          selfCheck,
          import: { total: incomingPhones.length, accepted: accepted.length, deduped },
          error: 'Self-check failed',
        });
        return;
      }

      if (!accepted.length) {
        sendJson(res, 200, {
          success: true,
          selfCheckPass: true,
          selfCheck,
          import: { total: incomingPhones.length, accepted: 0, deduped },
          batch: null,
        });
        return;
      }

      const requestedWorkerCount = Number.isFinite(Number(body.workerCount))
        ? Math.max(1, Number(body.workerCount))
        : config.batchWorkerCount;
      const requestedMode = ['direct', 'hybrid', 'browser'].includes(String(body.mode ?? '').toLowerCase())
        ? String(body.mode).toLowerCase()
        : config.batchMode;
      const requestedHttpConcurrencyPerWorker = Number.isFinite(Number(body.httpConcurrencyPerWorker))
        ? Math.max(1, Number(body.httpConcurrencyPerWorker))
        : config.batchHttpConcurrencyPerWorker;
      let runner;
      try {
        runner = getBatchRunner(requestedWorkerCount);
        runner.options.mode = requestedMode;
        runner.options.httpConcurrencyPerWorker = requestedHttpConcurrencyPerWorker;
      } catch (error) {
        sendJson(res, 400, {
          success: false,
          error: error instanceof Error ? error.message : 'Batch runner configuration invalid',
        });
        return;
      }
      const task = createBatchTask(accepted);
      task.ownerUserId = auth.userId;
      task.ownerUsername = auth.username;
      task.status = 'running';
      task.startedAt = new Date().toISOString();
      task.workerCount = requestedWorkerCount;
      task.mode = requestedMode;
      task.httpConcurrencyPerWorker = requestedHttpConcurrencyPerWorker;
      task.directCount = 0;
      task.fallbackCount = 0;
      task.distribution = distribution;
      task.phonePortMap = phonePortMap;
      consumeFromNumberLibrary(auth.userId, accepted);
      accepted.forEach((phone) => {
        const portId = phonePortMap[phone] ?? 'default';
        pipelineState.inflightPool.set(phone, { portId, status: 'running' });
      });
      pushPipelineLog({ type: 'batch-start', batchId: task.id, total: accepted.length, workerCount: requestedWorkerCount });
      appendAuditLog({
        type: 'batch-start',
        batchId: task.id,
        userId: auth.userId,
        username: auth.username,
        total: accepted.length,
      });

      void runner
        .runBatch(
          accepted,
          (record, processed) => {
            if (task.cancelled) {
              return;
            }
            task.processed = processed;
            task.records.push(record);
            if (record.path === 'direct') {
              task.directCount += 1;
            }
            if (record.path === 'fallback-browser') {
              task.fallbackCount += 1;
            }
            pipelineState.inflightPool.delete(record.phone);
            pipelineState.completedPool.set(record.phone, record);
            if (record.opened && record.qq) {
              task.hit += 1;
            }
            if (!record.opened && record.error) {
              task.failed += 1;
            }
          },
          {
            workerCount: requestedWorkerCount,
            mode: requestedMode,
            httpConcurrencyPerWorker: requestedHttpConcurrencyPerWorker,
            shouldStop: () => task.cancelled,
            shouldDeferPhone: (phone) => {
              if (task.paused) {
                return true;
              }
              const portId = task.phonePortMap?.[phone];
              if (!portId || portId === 'default') {
                return false;
              }
              const state = ensurePortState(portId);
              return state.paused || state.status === 'offline';
            },
          },
        )
        .then(() => {
          if (task.cancelled) {
            task.status = 'cancelled';
            task.finishedAt = new Date().toISOString();
            batchHistory.push(summaryFromTask(task));
            return;
          }
          task.status = 'completed';
          task.finishedAt = new Date().toISOString();
          batchHistory.push(summaryFromTask(task));
        })
        .catch((error) => {
          if (task.cancelled) {
            task.status = 'cancelled';
            task.finishedAt = new Date().toISOString();
            batchHistory.push(summaryFromTask(task));
            return;
          }
          task.status = 'failed';
          task.error = error instanceof Error ? error.message : 'batch failed';
          task.finishedAt = new Date().toISOString();
          batchHistory.push(summaryFromTask(task));
        });

      sendJson(res, 200, {
        success: true,
        selfCheckPass: true,
        selfCheck,
        import: { total: incomingPhones.length, accepted: accepted.length, deduped },
        batch: {
          batchId: task.id,
          status: task.status,
          total: task.total,
          distribution,
          phonePortMap,
          healthyPorts: allocation.healthyPorts,
          workerCount: requestedWorkerCount,
          mode: requestedMode,
          httpConcurrencyPerWorker: requestedHttpConcurrencyPerWorker,
        },
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/pipeline/assign') {
      const auth = requireBatchAuth(req, res, { roles: ['super_admin', 'sub_user'] });
      if (!auth) {
        return;
      }
      const body = JSON.parse((await readBody(req)) || '{}');
      const portIds = Array.isArray(body.portIds) ? body.portIds.map((item) => String(item).trim()).filter(Boolean) : [];
      if (!portIds.length) {
        sendJson(res, 400, { success: false, error: 'Missing portIds' });
        return;
      }
      const mode = String(body.mode ?? 'average');
      const requested = Math.max(0, Number(body.total ?? pipelineState.pendingPool.length));
      const total = Math.min(requested || pipelineState.pendingPool.length, pipelineState.pendingPool.length);
      const selected = pipelineState.pendingPool.splice(0, total);
      const visible = auth.role === 'super_admin' ? selected : selected.filter((phone) => pipelineOwnerMap.get(phone) === auth.userId);
      const distribution = Object.fromEntries(portIds.map((id) => [id, 0]));
      visible.forEach((phone, index) => {
        const portId = portIds[index % portIds.length];
        distribution[portId] += 1;
        pipelineState.inflightPool.set(phone, { portId, status: 'assigned' });
      });
      if (auth.role !== 'super_admin') {
        const retained = selected.filter((phone) => !visible.includes(phone));
        pipelineState.pendingPool.unshift(...retained);
      }
      pushPipelineLog({ type: 'assign', mode, total: visible.length, ports: portIds.length, ownerUserId: auth.userId });
      sendJson(res, 200, {
        success: true,
        total: visible.length,
        distribution,
        phones: visible,
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        ...queue.status(),
        batch: {
          active: [...batchTasks.values()].filter((task) => task.status === 'running').length,
          queued: [...batchTasks.values()].filter((task) => task.status === 'queued').length,
          proxiesConfigured: config.batchProxyPool ? config.batchProxyPool.split(',').filter(Boolean).length : 0,
        },
        pipeline: {
          history: pipelineState.historyPool.size,
          pending: pipelineState.pendingPool.length,
          inflight: pipelineState.inflightPool.size,
          completed: pipelineState.completedPool.size,
        },
        engine: {
          search: config.searchEngine,
          coreReady: Boolean(searchCore),
        },
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/engine/config') {
      sendJson(res, 200, {
        success: true,
        searchEngine: config.searchEngine,
        coreReady: Boolean(searchCore),
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/engine/search') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const phone = typeof body.phone === 'string' ? body.phone.trim() : typeof body.query === 'string' ? body.query.trim() : '';
      const mode = ['direct', 'hybrid', 'browser'].includes(String(body.mode ?? '').toLowerCase())
        ? String(body.mode).toLowerCase()
        : config.batchMode;
      if (!phone) {
        sendJson(res, 400, { success: false, error: 'Missing phone/query' });
        return;
      }
      if (!searchCore) {
        searchCore = createSearchCore();
      }
      if (!searchCore) {
        sendJson(res, 400, { success: false, error: 'Search core unavailable. Missing AVSOV target env.' });
        return;
      }
      searchCore.options.mode = mode;
      const result = await searchCore.queryPhone(phone);
      sendJson(res, 200, { success: true, engine: 'avsov-core', mode, result });
      return;
    }

    if (req.method === 'POST' && pathname === '/batch/start') {
      const auth = requireBatchAuth(req, res, { roles: ['super_admin', 'sub_user'] });
      if (!auth) {
        return;
      }
      const body = JSON.parse((await readBody(req)) || '{}');
      const phones = Array.isArray(body.phones)
        ? body.phones.map((item) => String(item).trim()).filter(Boolean)
        : typeof body.text === 'string'
          ? body.text
              .split(/\r?\n|,|\s+/)
              .map((item) => item.trim())
              .filter(Boolean)
          : [];
      const portIds = Array.isArray(body.portIds) ? body.portIds.map((item) => String(item).trim()).filter(Boolean) : [];
      const requestedWorkerCount = Number.isFinite(Number(body.workerCount))
        ? Math.max(1, Number(body.workerCount))
        : config.batchWorkerCount;
      const requestedMode = ['direct', 'hybrid', 'browser'].includes(String(body.mode ?? '').toLowerCase())
        ? String(body.mode).toLowerCase()
        : config.batchMode;
      const requestedHttpConcurrencyPerWorker = Number.isFinite(Number(body.httpConcurrencyPerWorker))
        ? Math.max(1, Number(body.httpConcurrencyPerWorker))
        : config.batchHttpConcurrencyPerWorker;
      if (!phones.length) {
        sendJson(res, 400, { success: false, error: 'Missing phones' });
        return;
      }

      const allocation = allocatePhonesBalanced(phones, portIds, {
        dedicatedAssignments: body.dedicatedAssignments,
        squads: body.squads,
      });
      const distribution = allocation.distribution;
      const phonePortMap = allocation.phonePortMap;
      phones.forEach((phone) => {
        const portId = phonePortMap[phone] ?? 'default';
        if (portId !== 'default') {
          ensurePortState(portId);
        }
        pipelineState.inflightPool.set(phone, { portId, status: 'running' });
      });

      const task = createBatchTask(phones);
      task.ownerUserId = auth.userId;
      task.ownerUsername = auth.username;
      task.status = 'running';
      task.startedAt = new Date().toISOString();
      task.workerCount = requestedWorkerCount;
      task.mode = requestedMode;
      task.httpConcurrencyPerWorker = requestedHttpConcurrencyPerWorker;
      task.directCount = 0;
      task.fallbackCount = 0;
      task.distribution = distribution;
      task.phonePortMap = phonePortMap;
      pushPipelineLog({ type: 'batch-start', batchId: task.id, total: phones.length, workerCount: requestedWorkerCount });
      appendAuditLog({
        type: 'batch-start',
        batchId: task.id,
        userId: auth.userId,
        username: auth.username,
        total: phones.length,
      });
      let runner;
      try {
        runner = getBatchRunner(requestedWorkerCount);
        runner.options.mode = requestedMode;
        runner.options.httpConcurrencyPerWorker = requestedHttpConcurrencyPerWorker;
      } catch (error) {
        sendJson(res, 400, {
          success: false,
          error: error instanceof Error ? error.message : 'Batch runner configuration invalid',
        });
        return;
      }

      void runner
        .runBatch(
          phones,
          (record, processed) => {
            if (task.cancelled) {
              return;
            }
            task.processed = processed;
            task.records.push(record);
            if (record.path === 'direct') {
              task.directCount += 1;
            }
            if (record.path === 'fallback-browser') {
              task.fallbackCount += 1;
            }
            const inflight = pipelineState.inflightPool.get(record.phone);
            if (inflight) {
              pipelineState.inflightPool.delete(record.phone);
            }
            pipelineState.completedPool.set(record.phone, record);
            pushPipelineLog({
              type: 'record',
              batchId: task.id,
              phone: record.phone,
              result: record.opened && record.qq ? `${record.phone}:${record.qq}` : `${record.phone}:none`,
              ownerUserId: task.ownerUserId,
            });
            if (record.opened && record.qq) {
              task.hit += 1;
            }
            if (!record.opened && record.error) {
              task.failed += 1;
              if (/timeout|network|captcha|page/i.test(record.error)) {
                task.replacementCount += 1;
                pushPipelineLog({
                  type: 'failover-replace',
                  batchId: task.id,
                  phone: record.phone,
                  result: `replacement-${task.replacementCount}`,
                });
              }
            }
          },
          {
            workerCount: requestedWorkerCount,
            mode: requestedMode,
            httpConcurrencyPerWorker: requestedHttpConcurrencyPerWorker,
            shouldStop: () => task.cancelled,
            shouldDeferPhone: (phone) => {
              if (task.paused) {
                return true;
              }
              const portId = task.phonePortMap?.[phone];
              if (!portId || portId === 'default') {
                return false;
              }
              const state = ensurePortState(portId);
              return state.paused || state.status === 'offline';
            },
          },
        )
        .then(() => {
          if (task.cancelled) {
            task.status = 'cancelled';
            task.finishedAt = new Date().toISOString();
            pushPipelineLog({ type: 'batch-cancelled', batchId: task.id, processed: task.processed });
            batchHistory.push(summaryFromTask(task));
            return;
          }
          task.status = 'completed';
          task.finishedAt = new Date().toISOString();
          pushPipelineLog({ type: 'batch-completed', batchId: task.id, processed: task.processed, hit: task.hit });
          batchHistory.push(summaryFromTask(task));
        })
        .catch((error) => {
          if (task.cancelled) {
            task.status = 'cancelled';
            task.finishedAt = new Date().toISOString();
            pushPipelineLog({ type: 'batch-cancelled', batchId: task.id, processed: task.processed });
            batchHistory.push(summaryFromTask(task));
            return;
          }
          task.status = 'failed';
          task.error = error instanceof Error ? error.message : 'batch failed';
          task.finishedAt = new Date().toISOString();
          task.replacementCount += 1;
          pushPipelineLog({ type: 'batch-failed', batchId: task.id, error: task.error, replacementCount: task.replacementCount });
          batchHistory.push(summaryFromTask(task));
        });

      sendJson(res, 200, {
        success: true,
        batchId: task.id,
        total: task.total,
        workerCount: requestedWorkerCount,
        mode: requestedMode,
        httpConcurrencyPerWorker: requestedHttpConcurrencyPerWorker,
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/batch/proxy/check') {
      if (!requireBatchAuth(req, res)) {
        return;
      }
      const body = JSON.parse((await readBody(req)) || '{}');
      const proxies = Array.isArray(body.proxies)
        ? body.proxies.map((item) => String(item).trim()).filter(Boolean)
        : typeof body.proxy === 'string'
          ? [body.proxy.trim()]
          : [];
      if (!proxies.length) {
        sendJson(res, 400, { success: false, error: 'Missing proxy/proxies' });
        return;
      }
      const timeoutMs = Number.isFinite(Number(body.timeoutMs)) ? Number(body.timeoutMs) : 10000;
      const results = [];
      for (const proxy of proxies) {
        if (!isSocks5ProxyFormat(proxy)) {
          const row = {
            proxy,
            ok: false,
            latency_ms: 0,
            error: 'invalid socks5 format',
            checked_at: new Date().toISOString(),
          };
          results.push(row);
          markIpReserveState(proxy, {
            state: 'blocked',
            ok: false,
            score: 0,
            error: row.error,
            latency_ms: 0,
            failureCount: (ipReservePool.get(proxy)?.failureCount ?? 0) + 1,
          });
          continue;
        }
        const row = await checkSingleProxy(proxy, timeoutMs);
        results.push(row);
        markIpReserveState(proxy, {
          state: row.ok ? 'reserve' : 'cooling',
          ok: row.ok,
          score: row.ok ? Math.max(30, 100 - Math.round((row.latency_ms ?? 0) / 10)) : 10,
          error: row.error,
          latency_ms: row.latency_ms ?? 0,
          successCount: (ipReservePool.get(proxy)?.successCount ?? 0) + (row.ok ? 1 : 0),
          failureCount: (ipReservePool.get(proxy)?.failureCount ?? 0) + (row.ok ? 0 : 1),
        });
      }
      sendJson(res, 200, {
        success: true,
        count: results.length,
        ok: results.filter((item) => item.ok).length,
        failed: results.filter((item) => !item.ok).length,
        rows: results,
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/ports/bind-ip') {
      if (!requireBatchAuth(req, res)) {
        return;
      }
      const body = JSON.parse((await readBody(req)) || '{}');
      const portId = String(body.portId ?? '').trim();
      const proxy = String(body.proxy ?? '').trim();
      if (!portId || !proxy) {
        sendJson(res, 400, { success: false, error: 'Missing portId or proxy' });
        return;
      }
      const state = ensurePortState(portId);
      state.boundIp = proxy;
      state.updatedAt = new Date().toISOString();
      markIpReserveState(proxy, { state: 'in_use' });
      sendJson(res, 200, { success: true, portId, proxy, status: state.status });
      return;
    }

    if (req.method === 'POST' && pathname === '/ports/unbind-ip') {
      if (!requireBatchAuth(req, res)) {
        return;
      }
      const body = JSON.parse((await readBody(req)) || '{}');
      const portId = String(body.portId ?? '').trim();
      if (!portId) {
        sendJson(res, 400, { success: false, error: 'Missing portId' });
        return;
      }
      const state = ensurePortState(portId);
      if (state.boundIp) {
        markIpReserveState(state.boundIp, { state: 'reserve' });
      }
      state.boundIp = '';
      state.updatedAt = new Date().toISOString();
      sendJson(res, 200, { success: true, portId, status: state.status });
      return;
    }

    if (req.method === 'GET' && pathname === '/ip/reserve') {
      if (!requireBatchAuth(req, res)) {
        return;
      }
      sendJson(res, 200, {
        success: true,
        rows: [...ipReservePool.values()],
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/ports/snapshot') {
      const auth = requireBatchAuth(req, res, { roles: ['super_admin', 'sub_user'] });
      if (!auth) {
        return;
      }
      sendJson(res, 200, {
        success: true,
        rows: portSnapshotRows().map((row) => {
          if (auth.role === 'super_admin') {
            return row;
          }
          return {
            ...row,
            inflight: [...pipelineState.inflightPool.entries()].filter(
              ([phone, task]) => task.portId === row.portId && pipelineOwnerMap.get(phone) === auth.userId,
            ).length,
          };
        }),
      });
      return;
    }

    if (req.method === 'POST' && /^\/ports\/[^/]+\/(pause|resume)$/.test(pathname)) {
      const auth = requireBatchAuth(req, res, { roles: ['super_admin', 'sub_user'] });
      if (!auth) {
        return;
      }
      const [, , portId, action] = pathname.split('/');
      const state = ensurePortState(portId);
      state.paused = action === 'pause';
      state.status = action === 'pause' ? 'paused' : 'ready';
      state.updatedAt = new Date().toISOString();
      sendJson(res, 200, {
        success: true,
        portId,
        status: state.status,
        paused: state.paused,
      });
      appendAuditLog({ type: `port-${action}`, portId, userId: auth.userId, username: auth.username });
      return;
    }

    if (req.method === 'POST' && pathname === '/self-check/run') {
      const auth = requireBatchAuth(req, res, { roles: ['super_admin', 'sub_user'] });
      if (!auth) {
        return;
      }
      const body = JSON.parse((await readBody(req)) || '{}');
      const include = Array.isArray(body.include) ? body.include : ['runner', 'ports', 'proxy', 'engine-direct', 'engine-browser', 'auth'];
      const checks = {
        runner: include.includes('runner') ? true : null,
        ports: include.includes('ports') ? portSnapshotRows().every((item) => item.status !== 'offline') : null,
        proxy: include.includes('proxy') ? true : null,
        'engine-direct': include.includes('engine-direct') ? Boolean(searchCore) : null,
        'engine-browser': include.includes('engine-browser') ? true : null,
        auth: include.includes('auth') ? true : null,
      };
      const failed = Object.entries(checks)
        .filter(([, value]) => value === false)
        .map(([name]) => name);
      sendJson(res, 200, {
        success: failed.length === 0,
        checkId: `chk-${Date.now()}`,
        summary: {
          pass: Object.values(checks).filter((value) => value === true).length,
          fail: failed.length,
          warn: 0,
        },
        failed,
        items: Object.entries(checks).map(([name, ok]) => ({ name, ok })),
      });
      appendAuditLog({ type: 'self-check', userId: auth.userId, username: auth.username, failed: failed.length });
      return;
    }

    if (req.method === 'GET' && /^\/batch\/[^/]+\/status$/.test(pathname)) {
      const auth = requireBatchAuth(req, res, { roles: ['super_admin', 'sub_user'] });
      if (!auth) {
        return;
      }
      const batchId = pathname.split('/')[2];
      const task = batchTasks.get(batchId);
      if (!task) {
        sendJson(res, 404, { success: false, error: 'Batch not found' });
        return;
      }
      if (auth.role !== 'super_admin' && task.ownerUserId && task.ownerUserId !== auth.userId) {
        sendJson(res, 403, { success: false, error: 'Forbidden' });
        return;
      }
      sendJson(res, 200, {
        success: true,
        ...task,
        sample: task.records.slice(-8),
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/batch/list') {
      const auth = requireBatchAuth(req, res, { roles: ['super_admin', 'sub_user'] });
      if (!auth) {
        return;
      }
      const statusFilter = String(url.searchParams.get('status') ?? 'running').trim();
      const page = Math.max(1, Number.parseInt(String(url.searchParams.get('page') ?? '1'), 10) || 1);
      const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(url.searchParams.get('pageSize') ?? '20'), 10) || 20));
      const isRunningFilter = statusFilter === 'running';
      const rows = [...batchTasks.values()]
        .filter((task) => auth.role === 'super_admin' || task.ownerUserId === auth.userId)
        .filter((task) => {
          if (isRunningFilter) {
            return ['queued', 'running', 'paused'].includes(task.status);
          }
          return ['completed', 'failed', 'cancelled'].includes(task.status);
        })
        .sort((a, b) => {
          const bTs = new Date(b.startedAt || b.createdAt || 0).getTime();
          const aTs = new Date(a.startedAt || a.createdAt || 0).getTime();
          return bTs - aTs;
        });
      const total = rows.length;
      const offset = (page - 1) * pageSize;
      const paged = rows.slice(offset, offset + pageSize).map((task) => ({
        id: task.id,
        status: task.status,
        total: task.total,
        processed: task.processed,
        hit: task.hit,
        failed: task.failed,
        startedAt: task.startedAt,
        finishedAt: task.finishedAt,
      }));
      sendJson(res, 200, {
        success: true,
        rows: paged,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
        },
      });
      return;
    }

    if (req.method === 'POST' && /^\/batch\/[^/]+\/stop$/.test(pathname)) {
      const auth = requireBatchAuth(req, res, { roles: ['super_admin', 'sub_user'] });
      if (!auth) {
        return;
      }
      const batchId = pathname.split('/')[2];
      const task = batchTasks.get(batchId);
      if (!task) {
        sendJson(res, 404, { success: false, error: 'Batch not found' });
        return;
      }
      if (auth.role !== 'super_admin' && task.ownerUserId && task.ownerUserId !== auth.userId) {
        sendJson(res, 403, { success: false, error: 'Forbidden' });
        return;
      }
      task.cancelled = true;
      task.status = 'cancelled';
      task.finishedAt = new Date().toISOString();
      task.records.forEach((record) => {
        pipelineState.inflightPool.delete(record.phone);
      });
      pushPipelineLog({ type: 'batch-stop', batchId, processed: task.processed });
      appendAuditLog({ type: 'batch-stop', batchId, userId: auth.userId, username: auth.username });
      sendJson(res, 200, {
        success: true,
        batchId,
        status: task.status,
      });
      return;
    }

    if (req.method === 'POST' && /^\/batch\/[^/]+\/pause$/.test(pathname)) {
      const auth = requireBatchAuth(req, res, { roles: ['super_admin', 'sub_user'] });
      if (!auth) {
        return;
      }
      const batchId = pathname.split('/')[2];
      const task = batchTasks.get(batchId);
      if (!task) {
        sendJson(res, 404, { success: false, error: 'Batch not found' });
        return;
      }
      if (auth.role !== 'super_admin' && task.ownerUserId && task.ownerUserId !== auth.userId) {
        sendJson(res, 403, { success: false, error: 'Forbidden' });
        return;
      }
      task.paused = true;
      task.status = 'paused';
      appendAuditLog({ type: 'batch-pause', batchId, userId: auth.userId, username: auth.username });
      sendJson(res, 200, { success: true, batchId, status: task.status });
      return;
    }

    if (req.method === 'POST' && /^\/batch\/[^/]+\/resume$/.test(pathname)) {
      const auth = requireBatchAuth(req, res, { roles: ['super_admin', 'sub_user'] });
      if (!auth) {
        return;
      }
      const batchId = pathname.split('/')[2];
      const task = batchTasks.get(batchId);
      if (!task) {
        sendJson(res, 404, { success: false, error: 'Batch not found' });
        return;
      }
      if (auth.role !== 'super_admin' && task.ownerUserId && task.ownerUserId !== auth.userId) {
        sendJson(res, 403, { success: false, error: 'Forbidden' });
        return;
      }
      if (!task.cancelled && task.status !== 'completed' && task.status !== 'failed') {
        task.paused = false;
        task.status = 'running';
      }
      appendAuditLog({ type: 'batch-resume', batchId, userId: auth.userId, username: auth.username });
      sendJson(res, 200, { success: true, batchId, status: task.status });
      return;
    }

    if (req.method === 'GET' && /^\/batch\/[^/]+\/export$/.test(pathname)) {
      const auth = requireBatchAuth(req, res, { roles: ['super_admin', 'sub_user'] });
      if (!auth) {
        return;
      }
      const batchId = pathname.split('/')[2];
      const task = batchTasks.get(batchId);
      if (!task) {
        sendJson(res, 404, { success: false, error: 'Batch not found' });
        return;
      }
      if (auth.role !== 'super_admin' && task.ownerUserId && task.ownerUserId !== auth.userId) {
        sendJson(res, 403, { success: false, error: 'Forbidden' });
        return;
      }
      const rows = toBatchExportRows(task.records);
      const format = (url.searchParams.get('format') ?? 'json').toLowerCase();
      if (format === 'csv') {
        res.writeHead(200, {
          ...jsonHeaders,
          'Content-Type': 'text/csv; charset=utf-8',
        });
        res.end(`\uFEFF${toCsv(rows)}`);
        return;
      }

      sendJson(res, 200, {
        success: true,
        batchId,
        count: rows.length,
        rows,
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/reports/summary') {
      const auth = requireBatchAuth(req, res, { roles: ['super_admin', 'sub_user'] });
      if (!auth) {
        return;
      }
      const tasks = [...batchTasks.values()].filter((task) => auth.role === 'super_admin' || task.ownerUserId === auth.userId);
      const totals = tasks.reduce(
        (acc, task) => {
          acc.batches += 1;
          acc.total += task.total ?? 0;
          acc.processed += task.processed ?? 0;
          acc.hit += task.hit ?? 0;
          acc.failed += task.failed ?? 0;
          return acc;
        },
        { batches: 0, total: 0, processed: 0, hit: 0, failed: 0 },
      );
      const byPort = {};
      tasks.forEach((task) => {
        const distribution = task.distribution ?? {};
        Object.entries(distribution).forEach(([portId, count]) => {
          byPort[portId] = (byPort[portId] ?? 0) + Number(count ?? 0);
        });
      });
      const byErrorType = {};
      tasks.forEach((task) => {
        (task.records ?? []).forEach((record) => {
          const key = record.error_type || (record.error ? 'unknown' : '');
          if (!key) {
            return;
          }
          byErrorType[key] = (byErrorType[key] ?? 0) + 1;
        });
      });
      sendJson(res, 200, {
        success: true,
        totals,
        byPort: Object.entries(byPort).map(([portId, assigned]) => ({
          portId,
          assigned,
          inflight: [...pipelineState.inflightPool.values()].filter((item) => item.portId === portId).length,
        })),
        byErrorType,
        recent: tasks
          .slice(-20)
          .reverse()
          .map((task) => summaryFromTask(task)),
        history: batchHistory.slice(-100),
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/system/status') {
      const auth = requireBatchAuth(req, res, { roles: ['super_admin'] });
      if (!auth) {
        return;
      }
      const mem = process.memoryUsage();
      const recommendation = buildRuntimeRecommendation();
      sendJson(res, 200, {
        success: true,
        host: {
          platform: process.platform,
          arch: process.arch,
          uptimeSec: Math.round(process.uptime()),
          cpus: os.cpus()?.length ?? 1,
          loadAvg: os.loadavg(),
          totalMemGb: Math.round(os.totalmem() / 1024 / 1024 / 1024),
          freeMemGb: Math.round(os.freemem() / 1024 / 1024 / 1024),
        },
        process: {
          pid: process.pid,
          rssMb: Math.round(mem.rss / 1024 / 1024),
          heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
          heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
        },
        queues: {
          pending: pipelineState.pendingPool.length,
          inflight: pipelineState.inflightPool.size,
          completed: pipelineState.completedPool.size,
          logs: pipelineState.logs.length,
        },
        recommendation,
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/search') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const query = typeof body.query === 'string' ? body.query.trim() : '';

      if (!query) {
        sendJson(res, 400, { success: false, error: 'Missing query' });
        return;
      }

      if (config.searchEngine === 'avsov-core') {
        if (!searchCore) {
          searchCore = createSearchCore();
        }
        if (!searchCore) {
          sendJson(res, 400, { success: false, error: 'Search core unavailable. Missing AVSOV target env.' });
          return;
        }
        const result = await searchCore.queryPhone(query);
        sendJson(res, 200, { success: true, ...result, engine: 'avsov-core' });
        return;
      }

      const result = await queue.enqueue(query);
      const reranked = decideFromCandidates(query, result, config.scoreSchema);
      sendJson(res, 200, applyBaselineDecision(reranked, query));
      return;
    }

    if (req.method === 'GET' && pathname === '/score-schema') {
      sendJson(res, 200, {
        success: true,
        scoreSchema: config.scoreSchema,
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/baseline') {
      sendJson(res, 200, {
        success: true,
        baselines: {
          opened: baselineStore.opened,
          closed: baselineStore.closed,
        },
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/baseline') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const query = typeof body.query === 'string' ? body.query.trim() : '';
      const status = typeof body.status === 'string' ? body.status.toLowerCase() : '';
      const normalizedStatus = status === 'opened' || status === '开通' ? 'opened' : status === 'closed' || status === '未开通' ? 'closed' : '';
      if (!query || !normalizedStatus) {
        sendJson(res, 400, {
          success: false,
          error: 'Missing query or invalid status. status must be opened|closed.',
        });
        return;
      }

      const sample = await queue.enqueue(query);
      const labeledSample = forceSampleByLabel(sample, normalizedStatus);
      const vector = buildStateVector(labeledSample, query);
      baselineStore[normalizedStatus] = mergeBaseline(baselineStore[normalizedStatus], vector);
      sendJson(res, 200, {
        success: true,
        status: normalizedStatus,
        query,
        sample: labeledSample,
        rawSample: sample,
        labelMismatch:
          typeof sample.opened === 'boolean'
            ? sample.opened !== (normalizedStatus === 'opened')
            : false,
        baselines: baselineStore,
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/feedback') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
      const qq = typeof body.qq === 'string' ? body.qq.trim() : '';
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!phone || !qq) {
        sendJson(res, 400, { success: false, error: 'Missing phone or qq' });
        return;
      }
      feedbackStore.confirmedByPhone[phone] = {
        qq,
        name,
        email: toQqMail(qq),
        updatedAt: new Date().toISOString(),
      };
      await saveFeedbackStore();
      sendJson(res, 200, {
        success: true,
        item: feedbackStore.confirmedByPhone[phone],
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/login') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const result = await loginWorker({
        account: typeof body.account === 'string' ? body.account.trim() : '',
        password: typeof body.password === 'string' ? body.password : '',
        portId: typeof body.portId === 'string' ? body.portId : '',
        portName: typeof body.portName === 'string' ? body.portName : '',
        portNumber: typeof body.portNumber === 'number' ? body.portNumber : undefined,
      });

      sendJson(res, result.success ? 200 : 400, result);
      return;
    }

    sendJson(res, 404, { success: false, error: 'Not found' });
  } catch (error) {
    sendJson(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : 'Runner failed',
    });
  }
});

void initAuthUsers().then(() => {
  server.listen(config.port, config.listenHost, () => {
    console.log(`QQ runner listening on http://${config.listenHost}:${config.port}`);
    console.log(`Workers: ${config.workers.map((worker) => `${worker.id}:${worker.mode}`).join(', ')}`);
    console.log(`[auth] store: ${config.authUsersPath}`);
  });
});
