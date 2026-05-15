/**
 * 用法: node scripts/add-subaccount.mjs <username> <password> [auth-users.json路径]
 * 默认路径: <项目>/.cache/auth-users.json
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const hashPassword = (password, salt) => createHash('sha256').update(`${salt}:${password}`).digest('hex');

const username = String(process.argv[2] ?? '').trim();
const password = String(process.argv[3] ?? '');
const authPath =
  process.argv[4]?.trim() ||
  resolve(__dirname, '..', '.cache', 'auth-users.json');

if (!username || !password) {
  console.error('Usage: node scripts/add-subaccount.mjs <username> <password> [auth-users.json]');
  process.exit(1);
}

let payload = { version: 1, users: [] };
try {
  payload = JSON.parse(await readFile(authPath, 'utf8'));
} catch (err) {
  if (err && typeof err === 'object' && 'code' in err && err.code !== 'ENOENT') {
    throw err;
  }
}
if (!Array.isArray(payload.users)) {
  payload.users = [];
}
payload.users = payload.users.filter((u) => u.username !== username);
const salt = randomBytes(12).toString('hex');
payload.users.push({
  userId: `u-${username}`,
  username,
  role: 'sub_user',
  status: 'active',
  permissions: ['self'],
  salt,
  passwordHash: hashPassword(password, salt),
  createdAt: new Date().toISOString(),
  lastLoginAt: '',
});
payload.savedAt = new Date().toISOString();
await mkdir(dirname(authPath), { recursive: true });
await writeFile(authPath, JSON.stringify(payload, null, 2), 'utf8');
console.log(`OK: sub_user "${username}" -> ${authPath}`);
