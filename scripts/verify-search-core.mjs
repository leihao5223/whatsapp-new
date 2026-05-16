import { AvsovSearchCore, decryptTarget } from './avsov-search-core.mjs';

const phone = String(process.argv[2] ?? '').trim();
if (!phone) {
  console.error('Usage: node scripts/verify-search-core.mjs <phone> [mode]');
  process.exit(1);
}

const mode = String(process.argv[3] ?? process.env.AVSOV_RUN_MODE ?? 'hybrid').toLowerCase();
const encryptedTarget = process.env.AVSOV_TARGET_URL_ENC;
const targetSecret = process.env.AVSOV_TARGET_SECRET;
if (!encryptedTarget || !targetSecret) {
  console.error('Missing env: AVSOV_TARGET_URL_ENC and AVSOV_TARGET_SECRET');
  process.exit(1);
}

const targetUrl = decryptTarget(encryptedTarget, targetSecret);
const core = new AvsovSearchCore({
  targetUrl,
  mode,
  maxRetries: Number(process.env.AVSOV_MAX_RETRIES ?? 2),
  requestTimeoutMs: Number(process.env.AVSOV_REQUEST_TIMEOUT_MS ?? 12000),
  minDelayMs: Number(process.env.AVSOV_MIN_DELAY_MS ?? 80),
  maxDelayMs: Number(process.env.AVSOV_MAX_DELAY_MS ?? 220),
  headless: process.env.AVSOV_HEADLESS ?? 'true',
});

const start = Date.now();
const result = await core.queryPhone(phone);
const elapsedMs = Date.now() - start;
console.log(
  JSON.stringify(
    {
      ok: true,
      elapsed_ms: elapsedMs,
      mode,
      result,
    },
    null,
    2,
  ),
);
