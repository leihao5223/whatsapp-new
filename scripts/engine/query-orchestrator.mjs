import { classifyError } from './classify-error.mjs';
import { queryDirect } from './direct-client.mjs';
import { queryBrowserFallback } from './fallback-client.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();
const normalizePhone = (value) => String(value ?? '').replace(/\D/g, '');

export { classifyError } from './classify-error.mjs';

/**
 * 编排：direct / hybrid / browser，统一输出字段供批次与 Runner 消费。
 */
export class AvsovSearchCore {
  constructor(options = {}) {
    if (!options.targetUrl) {
      throw new Error('Missing targetUrl for AvsovSearchCore');
    }
    this.targetUrl = String(options.targetUrl);
    this.options = {
      maxRetries: Number(options.maxRetries ?? 3),
      requestTimeoutMs: Number(options.requestTimeoutMs ?? 18000),
      mode: String(options.mode ?? 'hybrid').toLowerCase(),
      minDelayMs: Number(options.minDelayMs ?? 500),
      maxDelayMs: Number(options.maxDelayMs ?? 1300),
      headless: String(options.headless ?? 'true') !== 'false',
    };
  }

  async queryWithMode(phone, proxyServer) {
    const { targetUrl, requestTimeoutMs, minDelayMs, maxDelayMs, headless, mode } = {
      targetUrl: this.targetUrl,
      requestTimeoutMs: this.options.requestTimeoutMs,
      minDelayMs: this.options.minDelayMs,
      maxDelayMs: this.options.maxDelayMs,
      headless: this.options.headless,
      mode: this.options.mode,
    };

    if (mode === 'direct') {
      return queryDirect(phone, { targetUrl, requestTimeoutMs });
    }
    if (mode === 'browser') {
      const browserResult = await queryBrowserFallback(phone, {
        targetUrl,
        proxyServer,
        requestTimeoutMs,
        minDelayMs,
        maxDelayMs,
        headless,
      });
      return { ...browserResult, path: 'fallback-browser' };
    }
    try {
      return await queryDirect(phone, { targetUrl, requestTimeoutMs });
    } catch {
      const browserResult = await queryBrowserFallback(phone, {
        targetUrl,
        proxyServer,
        requestTimeoutMs,
        minDelayMs,
        maxDelayMs,
        headless,
      });
      return { ...browserResult, path: 'fallback-browser' };
    }
  }

  async queryPhone(phone, options = {}) {
    const normalized = normalizePhone(phone);
    if (normalized.length < 6) {
      throw new Error('invalid phone');
    }
    let attempt = 0;
    const maxRetries = Number(options.maxRetries ?? this.options.maxRetries);
    while (attempt <= maxRetries) {
      attempt += 1;
      const queryTime = nowIso();
      const startedAt = Date.now();
      try {
        const result = await this.queryWithMode(normalized, options.proxyServer);
        return {
          phone: normalized,
          qq: result.qq,
          query_time: queryTime,
          retry_count: attempt - 1,
          opened: result.opened,
          raw_text: result.rawText,
          path: result.path,
          latency_ms: Date.now() - startedAt,
          error_type: '',
        };
      } catch (error) {
        if (attempt > maxRetries) {
          return {
            phone: normalized,
            qq: '',
            query_time: queryTime,
            retry_count: attempt - 1,
            opened: false,
            raw_text: '',
            path: '',
            latency_ms: Date.now() - startedAt,
            error: error instanceof Error ? error.message : 'query failed',
            error_type: classifyError(error),
          };
        }
        await sleep(1200 * attempt);
      }
    }
    return {
      phone: normalized,
      qq: '',
      query_time: nowIso(),
      retry_count: maxRetries,
      opened: false,
      raw_text: '',
      path: '',
      latency_ms: 0,
      error: 'exhausted retries',
      error_type: 'exhausted',
    };
  }
}
