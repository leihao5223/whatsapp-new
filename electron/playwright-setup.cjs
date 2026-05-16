/**
 * 桌面版：把浏览器内核装到 desktop-bundle/pw-browsers，避免依赖用户本机 Node / 全局 Playwright。
 * 首次打开 EXE 时由 main.cjs 调用；也可由 scripts/ensure-playwright-browsers.ps1 单独执行。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MARKER = '.chromium-ready';

const getPwBrowsersPath = (bundleRoot) => path.join(bundleRoot, 'pw-browsers');

const isPlaywrightBrowsersReady = (bundleRoot) => {
  const marker = path.join(getPwBrowsersPath(bundleRoot), MARKER);
  return fs.existsSync(marker);
};

/**
 * @param {string} bundleRoot desktop-bundle 根目录
 * @param {{ onLog?: (line: string) => void }} opts
 * @returns {Promise<boolean>}
 */
const installPlaywrightBrowsers = (bundleRoot, opts = {}) => {
  const onLog = opts.onLog ?? (() => {});
  const pwBrowsersPath = getPwBrowsersPath(bundleRoot);
  fs.mkdirSync(pwBrowsersPath, { recursive: true });

  const nodeExe = path.join(bundleRoot, 'node.exe');
  const cliJs = path.join(bundleRoot, 'node_modules', 'playwright', 'cli.js');
  if (!fs.existsSync(nodeExe)) {
    onLog('缺少 portable node.exe，请重新下载完整安装包。\n');
    return Promise.resolve(false);
  }
  if (!fs.existsSync(cliJs)) {
    onLog('缺少 playwright CLI，请重新下载完整安装包。\n');
    return Promise.resolve(false);
  }

  const env = {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: pwBrowsersPath,
    NODE_OPTIONS: process.env.NODE_OPTIONS ?? '',
  };

  return new Promise((resolve) => {
    const proc = spawn(nodeExe, [cliJs, 'install', 'chromium'], {
      cwd: bundleRoot,
      env,
      windowsHide: true,
    });
    proc.stdout.on('data', (buf) => onLog(buf.toString()));
    proc.stderr.on('data', (buf) => onLog(buf.toString()));
    proc.on('error', (err) => {
      onLog(String(err.message ?? err));
      resolve(false);
    });
    proc.on('close', (code) => {
      if (code === 0) {
        try {
          fs.writeFileSync(path.join(pwBrowsersPath, MARKER), new Date().toISOString(), 'utf8');
        } catch {
          // ignore
        }
        resolve(true);
      } else {
        onLog(`\n安装进程退出码: ${code}\n`);
        resolve(false);
      }
    });
  });
};

/** 供 Runner 子进程继承：固定使用包内浏览器缓存目录 */
const playwrightBrowsersEnv = (bundleRoot) => ({
  PLAYWRIGHT_BROWSERS_PATH: getPwBrowsersPath(bundleRoot),
});

module.exports = {
  getPwBrowsersPath,
  isPlaywrightBrowsersReady,
  installPlaywrightBrowsers,
  playwrightBrowsersEnv,
};
