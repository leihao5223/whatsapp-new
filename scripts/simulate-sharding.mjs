import { createHash } from 'node:crypto';

const shardTotal = Math.max(1, Number(process.argv[2] ?? 8));
const nodeCount = Math.max(1, Number(process.argv[3] ?? 3));
const totalPhones = Math.max(1, Number(process.argv[4] ?? 200));

const phoneSeed = (index) => `17${String(100000000 + index).slice(-9)}`;
const hashPhone = (phone) => {
  const digest = createHash('sha1').update(phone).digest('hex');
  return Number.parseInt(digest.slice(0, 8), 16);
};

const shardOwner = Array.from({ length: shardTotal }, (_, i) => `node-${(i % nodeCount) + 1}`);
const seen = new Set();
const perNode = Object.fromEntries(Array.from({ length: nodeCount }, (_, i) => [`node-${i + 1}`, 0]));
let duplicates = 0;

for (let i = 0; i < totalPhones; i += 1) {
  const phone = phoneSeed(i);
  const shardId = hashPhone(phone) % shardTotal;
  const taskKey = `${phone}:${shardId}`;
  if (seen.has(taskKey)) {
    duplicates += 1;
  } else {
    seen.add(taskKey);
  }
  perNode[shardOwner[shardId]] += 1;
}

console.log(
  JSON.stringify(
    {
      shardTotal,
      nodeCount,
      totalPhones,
      duplicates,
      ownership: shardOwner.map((owner, shardId) => ({ shardId, owner })),
      loadByNode: perNode,
    },
    null,
    2,
  ),
);
