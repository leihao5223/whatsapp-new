import os from 'node:os';
import { resolvePlaywrightLauncher } from './playwright-browser.mjs';

const randomBetween = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

/**
 * 根因说明（给运维/客户）：
 * - 旧实现：每条走浏览器的号码都 chromium.launch + close，等于反复冷启动整颗 Chromium。
 *   并发 worker 越多，磁盘/CPU 越炸，表现为进度长时间停在 0/n（首条都跑不完）。
 * - 正确模型：进程内只保留一颗 Chromium，多条并发用多个 BrowserContext（多 Tab），这才是 Playwright 官方推荐的高并发方式。
 * - 并发上限默认随 CPU 核数放大；顶配机器可再设环境变量 QE_PLAYWRIGHT_MAX_CONTEXTS（上限 64）。
 * - 内核可设 QE_PLAYWRIGHT_BROWSER=chromium|firefox|webkit（需对应 playwright install）。
 */
const resolveMaxParallelContexts = () => {
  const raw = process.env.QE_PLAYWRIGHT_MAX_CONTEXTS;
  if (raw !== undefined && String(raw).trim() !== '') {
    const n = Number.parseInt(String(raw), 10);
    if (Number.isFinite(n) && n >= 1) {
      return Math.min(64, n);
    }
  }
  const cpus = Math.max(1, os.cpus()?.length ?? 4);
  return Math.max(4, Math.min(48, cpus * 4));
};

const MAX_PARALLEL_CONTEXTS = resolveMaxParallelContexts();

/** 避免每条号码都 launch/close 整颗 Chromium（大批量会卡死、进度长期为 0） */
let sharedBrowser;
let sharedBrowserHeadless = true;
let browserLaunchPromise;
const LAUNCH_TIMEOUT_MS = 120000;
let activeContexts = 0;
const contextWaitQueue = [];

const acquireContextSlot = async () => {
  if (activeContexts < MAX_PARALLEL_CONTEXTS) {
    activeContexts += 1;
    return;
  }
  await new Promise((resolve) => {
    contextWaitQueue.push(resolve);
  });
  activeContexts += 1;
};

const releaseContextSlot = () => {
  activeContexts -= 1;
  const next = contextWaitQueue.shift();
  if (next) {
    next();
  }
};

const getSharedBrowser = async (headless) => {
  if (sharedBrowser?.isConnected?.()) {
    return sharedBrowser;
  }
  if (browserLaunchPromise) {
    await browserLaunchPromise;
    if (sharedBrowser?.isConnected?.()) {
      return sharedBrowser;
    }
  }
  sharedBrowserHeadless = headless;
  browserLaunchPromise = (async () => {
    const { name, api } = resolvePlaywrightLauncher();
    const launch = api.launch({ headless: sharedBrowserHeadless });
    sharedBrowser = await Promise.race([
      launch,
      new Promise((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                `playwright ${name}.launch 超时（>${LAUNCH_TIMEOUT_MS / 1000}s）。请先安装内核：npx playwright install ${name}`,
              ),
            ),
          LAUNCH_TIMEOUT_MS,
        );
      }),
    ]);
  })();
  try {
    await browserLaunchPromise;
  } catch (err) {
    sharedBrowser = undefined;
    throw err;
  } finally {
    browserLaunchPromise = null;
  }
  return sharedBrowser;
};

/** 进程退出时可调用，避免残留浏览器进程 */
export const closeSharedPlaywrightBrowser = async () => {
  if (sharedBrowser) {
    try {
      await sharedBrowser.close();
    } catch {
      // ignore
    }
    sharedBrowser = undefined;
  }
};

const inferResult = (text, phone) => {
  const corpus = String(text ?? '').replace(/\s+/g, ' ').trim();
  const qqCandidates = corpus.match(/\b\d{5,12}\b/g) ?? [];
  const qq = qqCandidates.find((candidate) => candidate !== phone);
  const opened = Boolean(qq);
  return {
    opened,
    qq: opened ? qq : '',
    rawText: corpus.slice(0, 800),
  };
};

/**
 * 浏览器回退：页面 DOM 与脚本行为（与直连失败时衔接）。
 * 复用全局 Browser，仅开关 Context，代理放在 Context 上。
 */
export const queryBrowserFallback = async (phone, options) => {
  const {
    targetUrl,
    proxyServer,
    requestTimeoutMs,
    minDelayMs,
    maxDelayMs,
    headless,
  } = options;

  await acquireContextSlot();
  let context;
  try {
    const browser = await getSharedBrowser(headless);
    context = await browser.newContext({
      proxy: proxyServer ? { server: proxyServer } : undefined,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
    });
    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: requestTimeoutMs });
    await page.waitForTimeout(1200);

    const popupButton = page.locator('.mui-popup-button').first();
    if ((await popupButton.count()) > 0) {
      await popupButton.click({ timeout: 4000 }).catch(() => undefined);
      await page.waitForTimeout(300);
    }

    const input = page
      .locator('#qq, input[id="qq"], input[type="number"], input[type="tel"], input[name="qq"], input[name*="tel"]')
      .first();
    await input.waitFor({ state: 'visible', timeout: requestTimeoutMs });
    await input.fill(phone, { timeout: requestTimeoutMs });
    await input.dispatchEvent('input');
    await input.dispatchEvent('change');

    const button = page
      .locator('button.mui-btn-primary, button:has-text("查询"), button:has-text("搜索"), input[type="submit"]')
      .first();
    await button.waitFor({ state: 'visible', timeout: requestTimeoutMs });
    await button.click({ timeout: requestTimeoutMs }).catch(async () => {
      await page.evaluate(() => {
        if (typeof window.cx === 'function') {
          window.cx();
        }
      });
    });

    const pollDeadline = Date.now() + Math.min(28000, requestTimeoutMs);
    let qq = '';
    while (Date.now() < pollDeadline) {
      await page.waitForTimeout(350);
      const bodySnippet = await page.locator('body').innerText().catch(() => '');
      if (bodySnippet.includes('正在加载')) {
        continue;
      }
      const qqSpan = page.locator('#p').first();
      if ((await qqSpan.count()) > 0) {
        const raw = (await qqSpan.innerText().catch(() => '')).trim();
        const digits = raw.replace(/\D/g, '');
        if (digits.length >= 5 && digits !== phone) {
          qq = digits;
          break;
        }
      }
      if (/无.*绑定|未绑定|查无|无结果|失败|错误/i.test(bodySnippet)) {
        break;
      }
    }

    if (!qq) {
      await page.waitForTimeout(randomBetween(minDelayMs, maxDelayMs) + 800);
    }

    const qqSpanFinal = page.locator('#p').first();
    if (!qq && (await qqSpanFinal.count()) > 0) {
      qq = (await qqSpanFinal.innerText().catch(() => '')).replace(/\D/g, '');
      if (qq === phone) {
        qq = '';
      }
    }
    const bodyText = await page.locator('body').innerText({ timeout: requestTimeoutMs });
    if (qq) {
      return {
        opened: true,
        qq,
        rawText: String(bodyText ?? '').slice(0, 800),
      };
    }
    return inferResult(bodyText, phone);
  } finally {
    if (context) {
      await context.close().catch(() => undefined);
    }
    releaseContextSlot();
  }
};
