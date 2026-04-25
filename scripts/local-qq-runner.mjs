import { createServer } from 'node:http';

const jsonHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const clampScore = (score) => Math.max(0, Math.min(100, Math.round(score)));

const categoryFromScore = (score) => {
  if (score >= 86) {
    return '高价值';
  }

  if (score >= 60) {
    return '待复核';
  }

  return '无效线索';
};

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

const parseList = (value) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const createWorkers = () => {
  const accountIds = parseList(process.env.QQ_RUNNER_ACCOUNTS);
  const bridgeUrls = parseList(process.env.QQ_BRIDGE_URLS || process.env.QQ_BRIDGE_URL);
  const workerCount = Number.parseInt(process.env.QQ_RUNNER_WORKERS ?? '2', 10);

  if (bridgeUrls.length) {
    return bridgeUrls.map((bridgeUrl, index) => ({
      id: accountIds[index] ?? `qq-${index + 1}`,
      label: `QQ窗口 ${accountIds[index] ?? index + 1}`,
      mode: 'bridge',
      bridgeUrl,
    }));
  }

  const simulatorIds = accountIds.length
    ? accountIds
    : Array.from({ length: Math.max(1, workerCount) }, (_, index) => `sim-${index + 1}`);

  return simulatorIds.map((id, index) => ({
    id,
    label: `模拟QQ窗口 ${index + 1}`,
    mode: 'simulator',
  }));
};

const loadConfig = () => ({
  port: Number.parseInt(process.env.QQ_RUNNER_PORT ?? '8787', 10),
  concurrency: Math.max(1, Number.parseInt(process.env.QQ_RUNNER_CONCURRENCY ?? '2', 10)),
  delayMs: Math.max(0, Number.parseInt(process.env.QQ_RUNNER_DELAY_MS ?? '450', 10)),
  workers: createWorkers(),
});

const simulatorSearch = async (query, worker, delayMs) => {
  await sleep(delayMs + Math.random() * 320);

  if (/empty|unknown|无结果/i.test(query)) {
    return {
      success: false,
      workerId: worker.id,
      source: worker.label,
    };
  }

  const seed = Array.from(query).reduce((total, char) => total + char.charCodeAt(0), 0);
  const score = clampScore(58 + (seed % 40));

  return {
    success: true,
    title: `QQ 搜索命中 ${query.slice(0, 18)}`,
    category: categoryFromScore(score),
    summary: `${worker.label} 已完成 "${query}" 的搜索校验。当前使用模拟器，配置 QQ_BRIDGE_URLS 后会转发到真实 QQ 窗口桥接器。`,
    confidence: score,
    score,
    source: worker.label,
    tags: ['QQ搜索', '模拟器', worker.id],
    workerId: worker.id,
  };
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

const runWorkerSearch = (query, worker, config) =>
  worker.mode === 'bridge' ? bridgeSearch(query, worker) : simulatorSearch(query, worker, config.delayMs);

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
        connected: worker.mode === 'simulator' || Boolean(bridgeUrl),
      })),
    };
  }

  enqueue(query) {
    return new Promise((resolve, reject) => {
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

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, jsonHeaders);
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true, ...queue.status() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/search') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const query = typeof body.query === 'string' ? body.query.trim() : '';

      if (!query) {
        sendJson(res, 400, { success: false, error: 'Missing query' });
        return;
      }

      const result = await queue.enqueue(query);
      sendJson(res, 200, result);
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

server.listen(config.port, () => {
  console.log(`QQ runner listening on http://127.0.0.1:${config.port}`);
  console.log(`Workers: ${config.workers.map((worker) => `${worker.id}:${worker.mode}`).join(', ')}`);
});
