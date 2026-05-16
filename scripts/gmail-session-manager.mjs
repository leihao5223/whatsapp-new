import { join } from 'node:path';
import { resolvePlaywrightLauncher } from './engine/playwright-browser.mjs';
import { createGmailBrowserContext } from './gmail-profile-runner.mjs';

/** @type {Map<string, { context: import('playwright').BrowserContext; page: import('playwright').Page; email: string; userId: string; accountId: string; lastUsed: number }>} */
const liveSessions = new Map();

const sessionKey = (userId, accountId) => `${sanitizeUserId(userId)}::${accountId}`;

const sanitizeUserId = (userId) => String(userId ?? '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown';

export const getSession = (userId, accountId) => liveSessions.get(sessionKey(userId, accountId));

export const listSessionsForUser = (userId) =>
  [...liveSessions.entries()]
    .filter(([k]) => k.startsWith(`${sanitizeUserId(userId)}::`))
    .map(([, v]) => ({ accountId: v.accountId, email: v.email, lastUsed: v.lastUsed }));

export async function closeSession(userId, accountId) {
  const key = sessionKey(userId, accountId);
  const s = liveSessions.get(key);
  if (!s) {
    return false;
  }
  liveSessions.delete(key);
  await s.context.close().catch(() => {});
  return true;
}

export async function closeAllSessionsForUser(userId) {
  const prefix = `${sanitizeUserId(userId)}::`;
  const keys = [...liveSessions.keys()].filter((k) => k.startsWith(prefix));
  for (const key of keys) {
    const s = liveSessions.get(key);
    liveSessions.delete(key);
    await s?.context.close().catch(() => {});
  }
}

/**
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.accountId
 * @param {string} opts.email
 * @param {string} opts.profileDir
 * @param {boolean} [opts.headless]
 * @param {import('playwright').Page} [opts.page] — reuse page from login flow
 * @param {import('playwright').BrowserContext} [opts.context]
 */
export async function attachSession({ userId, accountId, email, profileDir, headless = true, page, context }) {
  const key = sessionKey(userId, accountId);
  const existing = liveSessions.get(key);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing;
  }

  if (context && page) {
    const session = { context, page, email, userId, accountId, lastUsed: Date.now() };
    liveSessions.set(key, session);
    return session;
  }

  const { api: browserApi } = resolvePlaywrightLauncher();
  const ctx = await createGmailBrowserContext(browserApi, profileDir);
  const pg = ctx.pages()[0] ?? (await ctx.newPage());
  const session = { context: ctx, page: pg, email, userId, accountId, lastUsed: Date.now() };
  liveSessions.set(key, session);
  return session;
}

export async function touchSession(userId, accountId) {
  const s = liveSessions.get(sessionKey(userId, accountId));
  if (s) {
    s.lastUsed = Date.now();
  }
  return s ?? null;
}
