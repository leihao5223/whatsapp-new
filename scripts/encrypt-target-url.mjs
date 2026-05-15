import { encryptTargetForEnv } from './avsov-batch-runner.mjs';

const targetUrl = process.argv[2];
const secret = process.argv[3];

if (!targetUrl || !secret) {
  console.error('Usage: node scripts/encrypt-target-url.mjs <target_url> <secret>');
  process.exit(1);
}

const encrypted = encryptTargetForEnv(targetUrl, secret);
console.log(encrypted);
