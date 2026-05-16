import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { resolvePlaywrightLauncher } from './engine/playwright-browser.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sanitizeEmailDir = (email) =>
  String(email ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 120) || 'unknown';

/**
 * @param {import('playwright').Page} page
 * @param {string} email
 * @param {string} password
 */
async function gmailLogin(page, email, password) {
  await page.goto('https://mail.google.com', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

  const emailInput = page.locator('input[type="email"]').first();
  if ((await emailInput.count()) > 0) {
    await emailInput.fill(email);
    const nextBtn = page.locator('#identifierNext, button:has-text("下一步"), button:has-text("Next")').first();
    await nextBtn.click();
    await sleep(2000);
  }

  const passwordInput = page.locator('input[type="password"]').first();
  await passwordInput.waitFor({ state: 'visible', timeout: 25_000 });
  await passwordInput.fill(password);
  const passNext = page.locator('#passwordNext, button:has-text("下一步"), button:has-text("Next")').first();
  await passNext.click();

  await page.waitForURL(/mail\.google\.com\/mail/, { timeout: 90_000 });
  await sleep(2500);
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
      /* try next url */
    }
  }

  return { ok: false, message: '未能定位 Google 账号头像上传控件（可能需人工或 2FA）' };
}

/**
 * @param {import('playwright').Page} page
 */
async function gmailSignOut(page) {
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
 * @param {object} opts
 * @param {string} opts.email
 * @param {string} opts.password
 * @param {string} opts.newDisplayName
 * @param {string} [opts.avatarPath]
 * @param {string} opts.profilesRoot
 * @param {boolean} [opts.headless]
 * @param {() => boolean} [opts.shouldStop]
 * @param {(msg: string) => void} [opts.onLog]
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
    await gmailLogin(page, email, password);

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

    onLog('退出账号…');
    await gmailSignOut(page);

    return {
      success: true,
      email,
      displayName: newDisplayName,
      avatar: avatarResult,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * @param {string} profileDir
 */
export async function clearGmailProfileDir(profileDir) {
  if (existsSync(profileDir)) {
    await rm(profileDir, { recursive: true, force: true });
  }
}
