import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { resolvePlaywrightLauncher } from './engine/playwright-browser.mjs';
import { AvsovSearchCore, classifyError } from './engine/query-orchestrator.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();
const normalizePhone = (value) => String(value ?? '').replace(/\D/g, '');
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

const parseProxyList = (value) =>
  String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((entry, index) => ({
      id: `proxy-${index + 1}`,
      server: entry,
      failed: 0,
      success: 0,
      coolingUntil: 0,
    }));

const randomBetween = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

const normalizeSecret = (secret) => createHash('sha256').update(String(secret ?? '')).digest();

const decryptTarget = (cipherText, secret) => {
  const [ivB64, dataB64, tagB64] = String(cipherText ?? '').split('.');
  if (!ivB64 || !dataB64 || !tagB64) {
    throw new Error('Invalid encrypted target format. Expected iv.data.tag');
  }
  const iv = Buffer.from(ivB64, 'base64url');
  const encrypted = Buffer.from(dataB64, 'base64url');
  const authTag = Buffer.from(tagB64, 'base64url');
  const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, normalizeSecret(secret), iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  if (!/^https?:\/\//i.test(decrypted)) {
    throw new Error('Decrypted target must be a valid URL');
  }
  return decrypted;
};

const inferResult = (text, phone) => {
  const corpus = String(text ?? '').replace(/\s+/g, ' ').trim();
  const qqCandidates = corpus.match(/\b\d{5,12}\b/g) ?? [];
  const qq = qqCandidates.find((candidate) => candidate !== phone);
  const opened = Boolean(qq);
  return {
    opened,
    qq: opened ? qq : '',
    rawText: corpus.slice(0, 800),
  };
};

export const isSocks5ProxyFormat = (value) =>
  /^socks5:\/\/(?:[^:@\s]+(?::[^@\s]*)?@)?[a-zA-Z0-9.-]+:\d{2,5}$/.test(String(value ?? '').trim());

export const checkSingleProxy = async (proxyUrl, timeoutMs = 10000) => {
  const normalized = String(proxyUrl ?? '').trim();
  if (!isSocks5ProxyFormat(normalized)) {
    return {
      proxy: normalized,
      ok: false,
      latency_ms: 0,
      error: 'invalid socks5 format',
      checked_at: nowIso(),
    };
  }

  const start = Date.now();
  let browser;
  try {
    const { api } = resolvePlaywrightLauncher();
    browser = await api.launch({
      headless: true,
      proxy: { server: normalized },
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('https://example.com', { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
    const latency = Date.now() - start;
    return {
      proxy: normalized,
      ok: true,
      latency_ms: latency,
      error: '',
      checked_at: nowIso(),
    };
  } catch (error) {
    return {
      proxy: normalized,
      ok: false,
      latency_ms: Date.now() - start,
      error: error instanceof Error ? error.message : 'proxy check failed',
      checked_at: nowIso(),
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
};

export class AvsovBatchRunner {
  constructor(options = {}) {
    const encryptedTarget = options.targetUrlEnc ?? process.env.AVSOV_TARGET_URL_ENC;
    const targetSecret = options.targetSecret ?? process.env.AVSOV_TARGET_SECRET;
    if (!encryptedTarget || !targetSecret) {
      throw new Error('Missing encrypted target config: AVSOV_TARGET_URL_ENC and AVSOV_TARGET_SECRET');
    }
    this.targetUrl = decryptTarget(encryptedTarget, targetSecret);
    this.targetApiUrl = this.targetUrl.replace(/\.html?(\?.*)?$/i, '');
    this.options = {
      maxRetries: Number(options.maxRetries ?? 3),
      requestTimeoutMs: Number(options.requestTimeoutMs ?? 18000),
      workerCount: Math.max(1, Number(options.workerCount ?? 2)),
      mode: String(options.mode ?? process.env.AVSOV_RUN_MODE ?? 'hybrid').toLowerCase(),
      httpConcurrencyPerWorker: Math.max(1, Number(options.httpConcurrencyPerWorker ?? process.env.AVSOV_HTTP_CONCURRENCY_PER_WORKER ?? 8)),
      minDelayMs: Number(options.minDelayMs ?? 500),
      maxDelayMs: Number(options.maxDelayMs ?? 1300),
      proxies: parseProxyList(options.proxyList ?? process.env.AVSOV_PROXY_POOL),
      headless: String(options.headless ?? process.env.AVSOV_HEADLESS ?? 'true') !== 'false',
    };
    this.proxyCursor = 0;
    this.searchCore = new AvsovSearchCore({
      targetUrl: this.targetUrl,
      maxRetries: this.options.maxRetries,
      requestTimeoutMs: this.options.requestTimeoutMs,
      mode: this.options.mode,
      minDelayMs: this.options.minDelayMs,
      maxDelayMs: this.options.maxDelayMs,
      headless: this.options.headless,
    });
  }

  nextProxy() {
    if (!this.options.proxies.length) {
      return undefined;
    }
    const now = Date.now();
    const candidates = this.options.proxies.filter((proxy) => proxy.coolingUntil <= now);
    const pool = candidates.length ? candidates : this.options.proxies;
    const proxy = pool[this.proxyCursor % pool.length];
    this.proxyCursor += 1;
    return proxy;
  }

  markProxy(proxy, success) {
    if (!proxy) {
      return;
    }
    if (success) {
      proxy.success += 1;
      proxy.failed = 0;
      proxy.coolingUntil = 0;
      return;
    }
    proxy.failed += 1;
    const cooldownMs = Math.min(120000, 2000 * 2 ** Math.min(proxy.failed, 5));
    proxy.coolingUntil = Date.now() + cooldownMs;
  }

  async runTask(task) {
    const phone = normalizePhone(task.phone);
    let attempt = 0;
    while (attempt <= this.options.maxRetries) {
      attempt += 1;
      const queryTime = nowIso();
      const proxy = this.nextProxy();
      try {
        const result = await this.searchCore.queryPhone(phone, {
          maxRetries: 0,
          proxyServer: proxy?.server,
        });
        this.markProxy(proxy, true);
        return {
          phone,
          qq: result.qq,
          query_time: queryTime,
          retry_count: attempt - 1,
          opened: result.opened,
          raw_text: result.rawText,
          path: result.path ?? '',
          latency_ms: Number(result.latency_ms ?? 0),
          error_type: result.error_type ?? '',
          proxy_id: proxy?.id ?? '',
        };
      } catch (error) {
        this.markProxy(proxy, false);
        const finalAttempt = attempt > this.options.maxRetries;
        if (finalAttempt) {
          return {
            phone,
            qq: '',
            query_time: queryTime,
            retry_count: attempt - 1,
            opened: false,
            error: error instanceof Error ? error.message : 'query failed',
            error_type: classifyError(error),
            raw_text: '',
            path: '',
            latency_ms: 0,
            proxy_id: proxy?.id ?? '',
          };
        }
        await sleep(1200 * attempt);
      }
    }
    return {
      phone,
      qq: '',
      query_time: nowIso(),
      retry_count: this.options.maxRetries,
      opened: false,
      error: 'exhausted retries',
      error_type: 'exhausted',
      raw_text: '',
      path: '',
      latency_ms: 0,
      proxy_id: '',
    };
  }

  async runBatch(phones, onProgress, options = {}) {
    const normalized = phones.map((item) => normalizePhone(item)).filter((item) => item.length >= 6);
    const queue = [...normalized];
    const results = [];
    const baseWorkers = Math.max(1, Number(options.workerCount ?? this.options.workerCount));
    const httpConcurrencyPerWorker = Math.max(
      1,
      Number(options.httpConcurrencyPerWorker ?? this.options.httpConcurrencyPerWorker ?? 1),
    );
    const mode = String(options.mode ?? this.options.mode ?? 'hybrid').toLowerCase();
    const workerCount = mode === 'browser' ? baseWorkers : baseWorkers * httpConcurrencyPerWorker;
    const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;
    const shouldDeferPhone = typeof options.shouldDeferPhone === 'function' ? options.shouldDeferPhone : () => false;
    /** 防止端口长期 pause/offline 时同一号码无限 requeue，队列永远不前进 */
    const deferStreak = new Map();

    const worker = async () => {
      while (queue.length) {
        if (shouldStop()) {
          break;
        }
        const phone = queue.shift();
        if (!phone) {
          break;
        }
        if (shouldDeferPhone(phone)) {
          const n = (deferStreak.get(phone) ?? 0) + 1;
          deferStreak.set(phone, n);
          if (n < 2000) {
            queue.push(phone);
            await sleep(300);
            continue;
          }
          // 超过阈值仍强制跑，避免 UI 永远 0/n
        }
        const result = await this.runTask({ phone });
        deferStreak.delete(phone);
        results.push(result);
        onProgress?.(result, results.length, normalized.length);
      }
    };

    const workers = Array.from({ length: workerCount }, () => worker());
    await Promise.all(workers);
    return results;
  }
}

export const toBatchExportRows = (records) =>
  records
    .filter((record) => record.opened && record.qq)
    .map((record) => ({
      phone: record.phone,
      qq: record.qq,
      query_time: record.query_time,
      retry_count: record.retry_count,
    }));

export const encryptTargetForEnv = (url, secret) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, normalizeSecret(secret), iv);
  const encrypted = Buffer.concat([cipher.update(url, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${encrypted.toString('base64url')}.${tag.toString('base64url')}`;
};
