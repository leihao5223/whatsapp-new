import { createDecipheriv, createHash } from 'node:crypto';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

const normalizeSecret = (secret) => createHash('sha256').update(String(secret ?? '')).digest();

export const decryptTarget = (cipherText, secret) => {
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
