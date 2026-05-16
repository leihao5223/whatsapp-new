import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { resolvePlaywrightLauncher } from './engine/playwright-browser.mjs';
import {
  createGmailBrowserContext,
  dismissGooglePrompts,
  isGmailInboxReady,
  navigateToInbox,
  performGmailLogin,
  sanitizeEmailDir,
} from './gmail-profile-runner.mjs';
import { attachSession, closeSession, getSession } from './gmail-session-manager.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @type {Map<string, { context: import('playwright').BrowserContext; page: import('playwright').Page; email: string; userId: string; accountId: string; status: string; hint: string; updatedAt: string }>} */
const pendingLogins = new Map();

const pendingKey = (userId, accountId) => `${String(userId).replace(/[^a-zA-Z0-9_-]/g, '_')}::${accountId}`;

export const getPendingLogin = (userId, accountId) => pendingLogins.get(pendingKey(userId, accountId));

const setPending = (userId, accountId, patch) => {
  const key = pendingKey(userId, accountId);
  const cur = pendingLogins.get(key) ?? {};
  const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  pendingLogins.set(key, next);
  return next;
};

export const clearPendingLogin = async (userId, accountId) => {
  const key = pendingKey(userId, accountId);
  const p = pendingLogins.get(key);
  pendingLogins.delete(key);
  if (p?.context) {
    await p.context.close().catch(() => {});
  }
};

/**
 * @param {import('playwright').Page} page
 */
async function detectChallenge(page) {
  if (await isGmailInboxReady(page)) {
    return { type: 'done', hint: '已进入收件箱' };
  }

  const url = page.url();
  const body = await page
    .locator('body')
    .innerText({ timeout: 5000 })
    .catch(() => '');

  const codeInput = page.locator(
    'input[type="tel"]:visible, input[name="totpPin"]:visible, input[id="idvPin"]:visible, input[aria-label*="验证码"]:visible, input[autocomplete="one-time-code"]:visible',
  );
  if ((await codeInput.count()) > 0 && (await codeInput.first().isVisible().catch(() => false))) {
    return { type: 'needs_code', hint: 'Google 需要验证码，请在下方输入' };
  }

  if (/在手机|on your phone|Tap Yes|确认是您本人|Verify it'?s you/i.test(body)) {
    return { type: 'needs_approve', hint: '请在手机上打开 Gmail/Google，点「是」或「允许」完成验证' };
  }

  const pwd = page.locator('input[type="password"]:visible, input[name="Passwd"]:visible');
  if ((await pwd.count()) > 0 && (await pwd.first().isVisible().catch(() => false))) {
    return { type: 'needs_password', hint: '正在输入密码…' };
  }

  if (/recaptcha|人机验证|证明您不是机器人/i.test(body)) {
    return { type: 'needs_captcha', hint: '需要人机验证，请稍后重试或更换网络' };
  }

  if (/accounts\.google\.com/.test(url) && /challenge/.test(url)) {
    return { type: 'needs_code', hint: '请按页面提示完成验证（可输入验证码）' };
  }

  if (/identifier|signin/.test(url)) {
    return { type: 'signing_in', hint: '正在打开 Google 登录页…' };
  }

  return { type: 'signing_in', hint: '登录进行中…' };
}

/**
 * @param {import('playwright').Page} page
 * @param {string} password
 */
async function fillPasswordIfVisible(page, password) {
  const pwd = page.locator('input[type="password"]:visible, input[name="Passwd"]:visible').first();
  if ((await pwd.count()) === 0 || !(await pwd.isVisible().catch(() => false))) {
    return false;
  }
  await pwd.fill('');
  await pwd.fill(password);
  const next = page.locator('#passwordNext button, #passwordNext, button:has-text("下一步"), button:has-text("Next")').first();
  await next.click({ timeout: 10_000 }).catch(() => {});
  await sleep(2500);
  return true;
}

/**
 * @param {import('playwright').Page} page
 * @param {string} code
 */
async function fillVerificationCode(page, code) {
  const input = page
    .locator(
      'input[type="tel"]:visible, input[name="totpPin"]:visible, input[id="idvPin"]:visible, input[autocomplete="one-time-code"]:visible',
    )
    .first();
  await input.waitFor({ state: 'visible', timeout: 15_000 });
  await input.fill('');
  await input.fill(String(code).trim());
  const next = page.locator('button:has-text("下一步"), button:has-text("Next"), #idvPreregisteredNext').first();
  await next.click({ timeout: 10_000 }).catch(() => {});
  await sleep(3000);
  await dismissGooglePrompts(page);
}

/**
 * @param {object} opts
 */
async function settleLogin(page, email, password) {
  await dismissGooglePrompts(page);
  await fillPasswordIfVisible(page, password);

  for (let i = 0; i < 8; i += 1) {
    const ch = await detectChallenge(page);
    if (ch.type === 'done') {
      await navigateToInbox(page);
      if (await isGmailInboxReady(page)) {
        return { success: true, status: 'logged_in', hint: '登录成功' };
      }
    }
    if (ch.type === 'needs_code') {
      return { success: false, status: 'needs_code', hint: ch.hint };
    }
    if (ch.type === 'needs_approve') {
      return { success: false, status: 'needs_approve', hint: ch.hint };
    }
    if (ch.type === 'needs_captcha') {
      return { success: false, status: 'failed', hint: ch.hint };
    }
    await sleep(1500);
  }

  if (await isGmailInboxReady(page)) {
    return { success: true, status: 'logged_in', hint: '登录成功' };
  }

  const ch = await detectChallenge(page);
  return { success: false, status: ch.type === 'signing_in' ? 'failed' : ch.type, hint: ch.hint };
}

/**
 * 打开真实 Google 登录（后台），支持暂停等待用户验证码/手机确认
 */
export async function startInteractiveLogin({ userId, accountId, email, password, profilesRoot }) {
  await closeSession(userId, accountId);
  await clearPendingLogin(userId, accountId);

  const profileDir = join(profilesRoot, sanitizeEmailDir(email));
  await mkdir(profileDir, { recursive: true });

  const { api: browserApi } = resolvePlaywrightLauncher();
  const context = await createGmailBrowserContext(browserApi, profileDir);
  const page = context.pages()[0] ?? (await context.newPage());

  setPending(userId, accountId, {
    context,
    page,
    email,
    userId,
    accountId,
    status: 'logging_in',
    hint: '正在打开 Google 登录…',
  });

  try {
    await page.goto('https://accounts.google.com/signin/v2/identifier?service=mail&flowName=GlifWebSignIn&flowEntry=ServiceLogin', {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await sleep(1500);

    if (await isGmailInboxReady(page)) {
      await attachSession({ userId, accountId, email, profileDir, page, context });
      await clearPendingLogin(userId, accountId);
      return { status: 'logged_in', hint: '已登录', sessionActive: true };
    }

    await performGmailLogin(page, email, password, { skipPrompts: true }).catch(() => {});

    let result = await settleLogin(page, email, password);

    if (result.status === 'needs_code' || result.status === 'needs_approve') {
      setPending(userId, accountId, { status: result.status, hint: result.hint });
      return { status: result.status, hint: result.hint, sessionActive: false };
    }

    if (result.success) {
      await attachSession({ userId, accountId, email, profileDir, page, context });
      pendingLogins.delete(pendingKey(userId, accountId));
      return { status: 'logged_in', hint: result.hint, sessionActive: true };
    }

    await context.close().catch(() => {});
    pendingLogins.delete(pendingKey(userId, accountId));
    return { status: 'failed', hint: result.hint || '登录失败', sessionActive: false };
  } catch (e) {
    await context.close().catch(() => {});
    pendingLogins.delete(pendingKey(userId, accountId));
    return { status: 'failed', hint: e instanceof Error ? e.message : String(e), sessionActive: false };
  }
}

export async function getInteractiveLoginStatus(userId, accountId, profilesRoot) {
  const pending = getPendingLogin(userId, accountId);
  if (!pending?.page) {
    const session = getSession(userId, accountId);
    if (session) {
      return { status: 'logged_in', hint: '已登录', sessionActive: true };
    }
    return { status: 'logged_out', hint: '', sessionActive: false };
  }

  const ch = await detectChallenge(pending.page);
  if (ch.type === 'done') {
    const profileDir = join(profilesRoot, sanitizeEmailDir(pending.email));
    await attachSession({
      userId,
      accountId,
      email: pending.email,
      profileDir,
      page: pending.page,
      context: pending.context,
    });
    pendingLogins.delete(pendingKey(userId, accountId));
    return { status: 'logged_in', hint: '登录成功', sessionActive: true };
  }

  const status =
    ch.type === 'needs_password' ? 'logging_in' : ch.type === 'signing_in' ? 'logging_in' : ch.type;
  setPending(userId, accountId, { status, hint: ch.hint });
  return { status, hint: ch.hint, sessionActive: false };
}

/**
 * @param {object} opts
 */
export async function submitInteractiveVerification({ userId, accountId, code, approved, profilesRoot, password }) {
  const pending = getPendingLogin(userId, accountId);
  if (!pending?.page) {
    return { status: 'failed', hint: '没有进行中的登录，请重新点登录' };
  }

  const { page, email, context } = pending;

  try {
    if (code) {
      await fillVerificationCode(page, code);
    }
    if (approved) {
      setPending(userId, accountId, { status: 'needs_approve', hint: '正在等待手机确认…' });
      for (let i = 0; i < 45; i += 1) {
        await dismissGooglePrompts(page);
        if (await isGmailInboxReady(page)) {
          break;
        }
        await sleep(2000);
      }
    }

    const result = await settleLogin(page, email, password || '');
    if (result.status === 'needs_code' || result.status === 'needs_approve') {
      setPending(userId, accountId, { status: result.status, hint: result.hint });
      return { status: result.status, hint: result.hint, sessionActive: false };
    }

    if (result.success) {
      const profileDir = join(profilesRoot, sanitizeEmailDir(email));
      await attachSession({ userId, accountId, email, profileDir, page, context });
      pendingLogins.delete(pendingKey(userId, accountId));
      return { status: 'logged_in', hint: '登录成功', sessionActive: true };
    }

    await context.close().catch(() => {});
    pendingLogins.delete(pendingKey(userId, accountId));
    return { status: 'failed', hint: result.hint, sessionActive: false };
  } catch (e) {
    return { status: 'failed', hint: e instanceof Error ? e.message : String(e), sessionActive: false };
  }
}

/**
 * @param {import('playwright').Page} page
 */
export async function snapshotInboxUnread(page) {
  await navigateToInbox(page);
  const data = await page.evaluate(() => {
    const rows = document.querySelectorAll('tr.zA');
    const ids = [];
    let unread = 0;
    for (const tr of rows) {
      if (ids.length >= 15) {
        break;
      }
      const subject = tr.querySelector('.bog')?.textContent?.trim() || '';
      const sender = tr.querySelector('.yX')?.getAttribute('email') || tr.querySelector('.yP')?.textContent?.trim() || '';
      const isUnread = tr.classList.contains('zE');
      if (isUnread) {
        unread += 1;
      }
      ids.push(`${sender}|${subject}`);
    }
    return { fingerprint: ids.join(';;'), unread, total: ids.length };
  });
  return data;
}
