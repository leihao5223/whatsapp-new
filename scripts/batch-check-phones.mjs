/**
 * 批量查号（与任务管理 hybrid 一致）。用法：node scripts/batch-check-phones.mjs [phones.txt]
 * 无参数时使用内置列表；从 stdin 或文件读取时每行一个号码。
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AvsovBatchRunner } from './avsov-batch-runner.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const loadEnv = (envPath) => {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
};

const DEFAULT_PHONES = `
13018581780
13018591782
13025104230
13025450074
13035782636
13045892166
13046842462
13046872162
13046882760
13048802367
13048802763
13049872166
13060813025
13060823824
13060853921
13060863221
13060863921
13066813525
13066813825
13066853224
13076509220
13076579324
13076589222
13076599322
13076599926
13076929888
13076949483
13076959089
13077559225
13126430276
13126470772
13189199027
13189603177
13189603479
13189623273
13189663176
13189683071
13189683470
13192555172
13192575770
`
  .trim()
  .split(/\r?\n/)
  .map((s) => s.replace(/\D/g, ''))
  .filter((s) => s.length >= 6);

const argPath = process.argv[2];
let phones = DEFAULT_PHONES;
if (argPath && existsSync(argPath)) {
  phones = readFileSync(argPath, 'utf8')
    .split(/\r?\n/)
    .map((s) => s.replace(/\D/g, ''))
    .filter((s) => s.length >= 6);
}

loadEnv(join(__dirname, '../deploy/runner.env'));
const mode = String(process.env.AVSOV_RUN_MODE ?? 'hybrid').toLowerCase();
const runner = new AvsovBatchRunner({ mode, workerCount: 1, httpConcurrencyPerWorker: 4 });

console.log(`mode=${mode}\tcount=${phones.length}\n`);
console.log(['序号', '手机号', '命中', 'QQ', '路径', '备注'].join('\t'));

let idx = 0;
for (const input of phones) {
  idx += 1;
  const r = await runner.runTask({ phone: input });
  const hit = Boolean(r.opened && r.qq);
  const note = r.error ? String(r.error).slice(0, 60) : '';
  console.log([idx, r.phone, hit ? '是' : '否', r.qq || '-', r.path || '-', note].join('\t'));
}
