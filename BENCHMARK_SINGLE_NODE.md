# Single-Node Benchmark (4C8G Baseline)

## Command

```bash
BENCHMARK_BASE_URL=http://127.0.0.1:8799 BENCHMARK_MODE=hybrid node scripts/benchmark-single-node.mjs --total=45 --pollMs=1200 --timeoutMs=240000
```

## Observed Output

- stable: 43 / min (`workerCount=8`, `httpConcurrencyPerWorker=6`)
- balanced: 78 / min (`workerCount=10`, `httpConcurrencyPerWorker=8`)
- burst: 110 / min (`workerCount=12`, `httpConcurrencyPerWorker=10`)

## Recommended Defaults

- Default for production warm-up:
  - `mode=hybrid`
  - `workerCount=10`
  - `httpConcurrencyPerWorker=8`
  - `requestTimeoutMs=12000`
  - `maxRetries=2`
- Burst profile (only if block rate remains low):
  - `workerCount=12`
  - `httpConcurrencyPerWorker=10`
  - keep `mode=hybrid`
- Backoff rule:
  - If fallback ratio > 25%, reduce `httpConcurrencyPerWorker` by 2
  - If `http_block` increases continuously, reduce total concurrency by 20%
