import { chromium, firefox, webkit } from 'playwright';

/**
 * 选择 Playwright 内核（默认 chromium）。
 * - firefox / webkit 有时内存曲线不同，但**不保证更省**，且目标页面可能在非 Chromium 上表现不一致。
 * - 切换后需在项目目录执行一次：`npx playwright install firefox` 或 `npx playwright install webkit`
 */
export const resolvePlaywrightLauncher = () => {
  const raw = String(process.env.QE_PLAYWRIGHT_BROWSER ?? 'chromium').toLowerCase().trim();
  if (raw === 'firefox' || raw === 'ff' || raw === 'gecko') {
    return { name: 'firefox', api: firefox };
  }
  if (raw === 'webkit' || raw === 'wk' || raw === 'safari') {
    return { name: 'webkit', api: webkit };
  }
  return { name: 'chromium', api: chromium };
};
