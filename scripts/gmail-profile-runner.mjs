import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { resolvePlaywrightLauncher } from './engine/playwright-browser.mjs';
import { attachSession, closeSession } from './gmail-session-manager.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const sanitizeEmailDir = (email) =>
  String(email ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 120) || 'unknown';

const DISMISS_LABELS = [
  'Not now',
  'Skip',
  'No thanks',
  'Later',
  "Don't turn on",
  'Cancel',
  'Got it',
  'I agree',
  'Accept all',
  'Continue',
  'Done',
  '不用了',
  '稍后',
  '跳过',
  '取消',
  '以后再说',
  '暂不',
  '我同意',
  '知道了',
  '继续',
  '完成',
  '确定',
];

/**
 * 自动关闭登录后常见引导/隐私/智能功能提示页
 * @param {import('playwright').Page} page
 */
export async function dismissGooglePrompts(page) {
  for (let round = 0; round < 10; round += 1) {
    await sleep(700);
    let clicked = false;
    for (const label of DISMISS_LABELS) {
      const btn = page
        .locator(
          `button:has-text("${label}"), div[role="button"]:has-text("${label}"), [jsname] button:has-text("${label}")`,
        )
        .first();
      if ((await btn.count()) > 0) {
        const visible = await btn.isVisible().catch(() => false);
        if (visible) {
          await btn.click({ timeout: 4000 }).catch(() => {});
          clicked = true;
          await sleep(400);
        }
      }
    }
    if (!clicked) {
      break;
    }
  }
}

/**
 * @param {import('playwright').Page} page
 */
export async function isGmailInboxReady(page) {
  const url = page.url();
  if (/accounts\.google\.com/.test(url) && /signin|ServiceLogin|challenge/.test(url)) {
    return false;
  }
  const inboxMarkers = page.locator(
    '[gh="cm"], [aria-label*="Compose"], [aria-label*="写邮件"], div[role="main"] table, div[role="main"] [role="row"]',
  );
  if ((await inboxMarkers.count()) > 0) {
    return true;
  }
  return /mail\.google\.com\/mail/.test(url) && !/signin/.test(url);
}

/**
 * @param {import('playwright').Page} page
 */
export async function navigateToInbox(page) {
  await page.goto('https://mail.google.com/mail/u/0/#inbox', {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForLoadState('networkidle', { timeout: 25_000 }).catch(() => {});
  await dismissGooglePrompts(page);
  await sleep(1500);
}

/**
 * @param {import('playwright').Page} page
 * @param {string} email
 * @param {string} password
 * @param {{ skipPrompts?: boolean }} [opts]
 */
export async function performGmailLogin(page, email, password, opts = {}) {
  await page.goto('https://mail.google.com/mail/u/0/#inbox', {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

  if (await isGmailInboxReady(page)) {
    if (opts.skipPrompts !== false) {
      await dismissGooglePrompts(page);
    }
    return { alreadyLoggedIn: true };
  }

  await page.goto('https://accounts.google.com/ServiceLogin?service=mail&continue=https://mail.google.com/mail/', {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await sleep(1500);

  const emailInput = page.locator('input[type="email"], input[name="identifier"]').first();
  if ((await emailInput.count()) > 0 && (await emailInput.isVisible().catch(() => false))) {
    await emailInput.fill(email);
    const nextBtn = page.locator('#identifierNext, button:has-text("下一步"), button:has-text("Next")').first();
    await nextBtn.click();
    await sleep(2000);
  }

  const passwordInput = page.locator('input[type="password"], input[name="Passwd"]').first();
  await passwordInput.waitFor({ state: 'visible', timeout: 35_000 });
  await passwordInput.fill(password);
  const passNext = page.locator('#passwordNext, button:has-text("下一步"), button:has-text("Next")').first();
  await passNext.click();

  await page.waitForURL(/mail\.google\.com\/mail|myaccount\.google\.com|google\.com\/mail/, {
    timeout: 120_000,
  });
  await sleep(2000);

  if (opts.skipPrompts !== false) {
    await dismissGooglePrompts(page);
  }

  await navigateToInbox(page);

  if (!(await isGmailInboxReady(page))) {
    throw new Error('登录未完成：未检测到 Gmail 收件箱（可能需要 2FA 或人工验证）');
  }

  return { alreadyLoggedIn: false };
}

/**
 * @param {import('playwright').Page} page
 * @param {number} [limit]
 */
export async function fetchGmailInbox(page, limit = 25) {
  await navigateToInbox(page);
  await page.waitForSelector('div[role="main"]', { timeout: 30_000 }).catch(() => {});
  await sleep(1200);

  const messages = await page.evaluate((max) => {
    const rows = document.querySelectorAll('tr.zA, div.Cp tr, div[role="main"] tr.zA');
    const out = [];
    for (const tr of rows) {
      if (out.length >= max) {
        break;
      }
      const senderEl = tr.querySelector('.yX, .yP, span[email]');
      const sender =
        senderEl?.getAttribute('email') ||
        senderEl?.getAttribute('name') ||
        senderEl?.textContent?.trim() ||
        '';
      const subject = tr.querySelector('.bog, .bqe')?.textContent?.trim() || '(无主题)';
      const snippet = tr.querySelector('.y2')?.textContent?.trim().replace(/^\s*-\s*/, '') || '';
      const timeEl = tr.querySelector('.xW span[title], .xY span');
      const time = timeEl?.getAttribute('title') || timeEl?.textContent?.trim() || '';
      const unread = tr.classList.contains('zE');
      if (!sender && !subject) {
        continue;
      }
      out.push({ sender, subject, snippet, time, unread });
    }
    return out;
  }, limit);

  return {
    fetchedAt: new Date().toISOString(),
    count: messages.length,
    messages,
  };
}

/**
 * @param {import('playwright').Page} page
 * @param {string} newName
 */
async function gmailUpdateDisplayName(page, newName) {
  await page.goto('https://mail.google.com/mail/u/0/#settings/general', {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await sleep(3000);
  await dismissGooglePrompts(page);

  let nameInput = page.locator('input[name="fullName"]').first();
  if ((await nameInput.count()) === 0) {
    nameInput = page.locator('label:has-text("姓名"), label:has-text("Name")').locator('..').locator('input').first();
  }
  if ((await nameInput.count()) === 0) {
    throw new Error('未找到 Gmail 设置中的「姓名」输入框');
  }

  await nameInput.click();
  await nameInput.fill('');
  await nameInput.fill(newName);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const saveButton = page
    .locator('button:has-text("保存更改"), button:has-text("Save changes"), button:has-text("保存")')
    .first();
  await saveButton.click({ timeout: 15_000 });

  await page
    .waitForSelector('text=您的更改已保存, text=Your changes have been saved', { timeout: 12_000 })
    .catch(() => {});
}

/**
 * @param {import('playwright').Page} page
 * @param {string} avatarPath
 */
async function gmailUpdateAvatar(page, avatarPath) {
  if (!avatarPath || !existsSync(avatarPath)) {
    return { ok: false, skipped: true, message: '无头像文件' };
  }

  const targets = [
    'https://myaccount.google.com/profile-picture',
    'https://myaccount.google.com/personal-info',
  ];

  for (const url of targets) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await sleep(2500);
      await dismissGooglePrompts(page);

      const fileInput = page.locator('input[type="file"]').first();
      if ((await fileInput.count()) > 0) {
        await fileInput.setInputFiles(avatarPath);
        await sleep(2000);
        const confirm = page
          .locator(
            'button:has-text("保存"), button:has-text("Save"), button:has-text("应用"), button:has-text("Set as profile photo")',
          )
          .first();
        if ((await confirm.count()) > 0) {
          await confirm.click({ timeout: 8000 }).catch(() => {});
        }
        await sleep(3000);
        return { ok: true, message: '头像已上传' };
      }

      const changePhoto = page
        .locator('button:has-text("更改"), button:has-text("Change"), [aria-label*="photo"], [aria-label*="照片"]')
        .first();
      if ((await changePhoto.count()) > 0) {
        await changePhoto.click();
        await sleep(1500);
        const fileInput2 = page.locator('input[type="file"]').first();
        if ((await fileInput2.count()) > 0) {
          await fileInput2.setInputFiles(avatarPath);
          await sleep(2500);
          return { ok: true, message: '头像已上传' };
        }
      }
    } catch {
      /* try next */
    }
  }

  return { ok: false, message: '未能定位 Google 账号头像上传控件' };
}

/**
 * @param {import('playwright').Page} page
 */
export async function gmailSignOut(page) {
  const accountBtn = page.locator('a[aria-label*="Google"], a[aria-label*="账户"], img[aria-label*="Account"]').first();
  if ((await accountBtn.count()) > 0) {
    await accountBtn.click({ timeout: 8000 }).catch(() => {});
    await sleep(1000);
    const signOut = page.locator('text=退出登录, text=Sign out, a:has-text("Sign out")').first();
    if ((await signOut.count()) > 0) {
      await signOut.click({ timeout: 8000 }).catch(() => {});
      await sleep(2000);
      return;
    }
  }
  await page.goto('https://accounts.google.com/Logout', { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {});
  await sleep(1500);
}

/**
 * 登录并保持会话（供收件箱查看）
 * @param {object} opts
 */
export async function loginGmailAndKeepSession({
  userId,
  accountId,
  email,
  password,
  profilesRoot,
  headless = true,
  onLog = () => {},
}) {
  const profileDir = join(profilesRoot, sanitizeEmailDir(email));
  await mkdir(profileDir, { recursive: true });

  const { api: browserApi } = resolvePlaywrightLauncher();
  const context = await browserApi.launchPersistentContext(profileDir, {
    headless,
    args: headless ? [] : ['--start-maximized'],
    viewport: { width: 1280, height: 900 },
  });
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    onLog(`正在登录 ${email}…`);
    const loginResult = await performGmailLogin(page, email, password, { skipPrompts: true });
    onLog(loginResult.alreadyLoggedIn ? '会话已存在，已确认收件箱' : '账密登录成功，已跳过引导页');

    if (!(await isGmailInboxReady(page))) {
      throw new Error('登录验证失败：收件箱未就绪');
    }

    await attachSession({
      userId,
      accountId,
      email,
      profileDir,
      headless,
      page,
      context,
    });

    return {
      success: true,
      email,
      alreadyLoggedIn: loginResult.alreadyLoggedIn,
      verified: true,
    };
  } catch (e) {
    await context.close().catch(() => {});
    throw e;
  }
}

/**
 * @param {object} opts
 */
export async function modifyGmailProfile({
  email,
  password,
  newDisplayName,
  avatarPath,
  profilesRoot,
  headless = true,
  shouldStop = () => false,
  onLog = () => {},
  keepSession = false,
  userId = '',
  accountId = '',
}) {
  if (shouldStop()) {
    throw new Error('任务已取消');
  }

  const profileDir = join(profilesRoot, sanitizeEmailDir(email));
  await mkdir(profileDir, { recursive: true });

  const { api: browserApi } = resolvePlaywrightLauncher();
  const context = await browserApi.launchPersistentContext(profileDir, {
    headless,
    args: headless ? [] : ['--start-maximized'],
    viewport: { width: 1280, height: 900 },
  });

  const page = context.pages()[0] ?? (await context.newPage());

  try {
    onLog(`登录 ${email}…`);
    await performGmailLogin(page, email, password, { skipPrompts: true });

    if (shouldStop()) {
      throw new Error('任务已取消');
    }

    onLog(`修改显示名称 → ${newDisplayName}`);
    await gmailUpdateDisplayName(page, newDisplayName);

    let avatarResult = { ok: false, skipped: true, message: '未设置头像' };
    if (avatarPath && existsSync(avatarPath)) {
      if (shouldStop()) {
        throw new Error('任务已取消');
      }
      onLog('上传头像…');
      avatarResult = await gmailUpdateAvatar(page, avatarPath);
    }

    if (keepSession && userId && accountId) {
      onLog('保持登录会话（不退出）');
      await navigateToInbox(page);
      await attachSession({ userId, accountId, email, profileDir, headless, page, context });
    } else {
      onLog('退出账号…');
      await gmailSignOut(page);
      await context.close().catch(() => {});
    }

    return {
      success: true,
      email,
      displayName: newDisplayName,
      avatar: avatarResult,
    };
  } catch (e) {
    await context.close().catch(() => {});
    throw e;
  }
}

/**
 * @param {string} userId
 * @param {string} accountId
 */
export async function logoutGmailSession(userId, accountId) {
  const closed = await closeSession(userId, accountId);
  return { closed };
}

/**
 * @param {string} profileDir
 */
export async function clearGmailProfileDir(profileDir) {
  if (existsSync(profileDir)) {
    await rm(profileDir, { recursive: true, force: true });
  }
}
