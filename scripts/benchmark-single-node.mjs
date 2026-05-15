const baseUrl = process.env.BENCHMARK_BASE_URL ?? 'http://127.0.0.1:8794';
const token = process.env.AVSOV_BATCH_TOKEN ?? 'Qq1314520..0254131q';
const benchmarkMode = String(process.env.BENCHMARK_MODE ?? 'hybrid').toLowerCase();

const readArg = (name, fallback) => {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};

const totalPhones = Math.max(1, Number(readArg('total', process.env.BENCHMARK_TOTAL ?? 120)));
const pollMs = Math.max(500, Number(readArg('pollMs', process.env.BENCHMARK_POLL_MS ?? 1200)));
const timeoutMs = Math.max(30_000, Number(readArg('timeoutMs', process.env.BENCHMARK_TIMEOUT_MS ?? 10 * 60_000)));

const profiles = [
  { name: 'stable', workerCount: 8, httpConcurrencyPerWorker: 6 },
  { name: 'balanced', workerCount: 10, httpConcurrencyPerWorker: 8 },
  { name: 'burst', workerCount: 12, httpConcurrencyPerWorker: 10 },
];

const phoneSeed = (index) => `17${String(100000000 + index).slice(-9)}`;
const phones = Array.from({ length: totalPhones }, (_, index) => phoneSeed(index));

const headers = {
  'Content-Type': 'application/json',
  'X-Runner-Token': token,
};

const percentile = (sorted, p) => {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
};

const startBatch = async (profile) => {
  const response = await fetch(`${baseUrl}/batch/start`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      phones,
      mode: benchmarkMode,
      workerCount: profile.workerCount,
      httpConcurrencyPerWorker: profile.httpConcurrencyPerWorker,
      portIds: Array.from({ length: profile.workerCount }, (_, i) => `bench-port-${i + 1}`),
    }),
  });
  if (!response.ok) {
    throw new Error(`batch/start failed ${response.status}`);
  }
  return response.json();
};

const readStatus = async (batchId) => {
  const response = await fetch(`${baseUrl}/batch/${batchId}/status`, { headers: { 'X-Runner-Token': token } });
  if (!response.ok) {
    throw new Error(`batch/status failed ${response.status}`);
  }
  return response.json();
};

const waitForFinish = async (batchId) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await readStatus(batchId);
    if (['completed', 'failed', 'cancelled'].includes(String(status.status))) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`benchmark timeout for ${batchId}`);
};

const runProfile = async (profile) => {
  const startedAt = Date.now();
  const started = await startBatch(profile);
  const result = await waitForFinish(started.batchId);
  const elapsedSec = Math.max(1, (Date.now() - startedAt) / 1000);
  const records = Array.isArray(result.records) ? result.records : [];
  const latencies = records
    .map((item) => Number(item.latency_ms ?? 0))
    .filter((item) => Number.isFinite(item) && item > 0)
    .sort((a, b) => a - b);
  const directCount = Number(result.directCount ?? 0);
  const fallbackCount = Number(result.fallbackCount ?? 0);
  const processed = Number(result.processed ?? 0);
  return {
    profile: profile.name,
    mode: benchmarkMode,
    workerCount: profile.workerCount,
    httpConcurrencyPerWorker: profile.httpConcurrencyPerWorker,
    totalConcurrency: profile.workerCount * profile.httpConcurrencyPerWorker,
    processed,
    elapsed_sec: Math.round(elapsedSec * 100) / 100,
    throughput_per_min: Math.round((processed / elapsedSec) * 60),
    direct_ratio: processed ? Math.round((directCount / processed) * 100) : 0,
    fallback_ratio: processed ? Math.round((fallbackCount / processed) * 100) : 0,
    failed: Number(result.failed ?? 0),
    p50_ms: percentile(latencies, 50),
    p90_ms: percentile(latencies, 90),
  };
};

const main = async () => {
  const outputs = [];
  for (const profile of profiles) {
    const output = await runProfile(profile);
    outputs.push(output);
  }
  console.log(JSON.stringify({ baseUrl, mode: benchmarkMode, totalPhones, outputs }, null, 2));
};

await main();
