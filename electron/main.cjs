const { app, BrowserWindow, dialog } = require('electron');

const path = require('path');

const fs = require('fs');

const { spawn } = require('child_process');

const {

  isPlaywrightBrowsersReady,

  installPlaywrightBrowsers,

  playwrightBrowsersEnv,

} = require('./playwright-setup.cjs');



let mainWindow;

let runnerChild;



const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));



const projectRootDev = path.join(__dirname, '..');



const getBundleRoot = () => {

  if (app.isPackaged) {

    return path.join(process.resourcesPath, 'desktop-bundle');

  }

  return projectRootDev;

};



const startRunner = () => {

  const cwd = getBundleRoot();

  const script = path.join(cwd, 'scripts', 'local-qq-runner.mjs');

  if (!fs.existsSync(script)) {

    console.error('Runner script missing:', script);

    return;

  }

  const spawnOpts = {

    cwd,

    stdio: 'ignore',

    windowsHide: true,

    env: { ...process.env },

  };

  const envFile = path.join(cwd, '.env');

  if (fs.existsSync(envFile)) {

    spawnOpts.env.QE_ENV_FILE = envFile;

  }

  if (app.isPackaged) {

    Object.assign(spawnOpts.env, playwrightBrowsersEnv(cwd));

  }

  if (app.isPackaged) {

    const nodeExe = path.join(cwd, 'node.exe');

    if (fs.existsSync(nodeExe)) {

      runnerChild = spawn(nodeExe, [script], spawnOpts);

    } else {

      runnerChild = spawn('node', [script], spawnOpts);

    }

  } else {

    const devScript = path.join(projectRootDev, 'scripts', 'local-qq-runner.mjs');

    runnerChild = spawn('node', [devScript], {

      cwd: projectRootDev,

      stdio: 'ignore',

      windowsHide: true,

      env: { ...process.env },

    });

  }

};



const waitForRunner = async () => {

  const port = process.env.QQ_RUNNER_PORT || '8787';

  const url = `http://127.0.0.1:${port}/health`;

  const deadline = Date.now() + 45000;

  while (Date.now() < deadline) {

    try {

      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });

      if (res.ok) {

        return port;

      }

    } catch {

      // ignore

    }

    await sleep(400);

  }

  return port;

};



/**

 * 打包版：首次启动自动下载 Playwright Chromium 到 desktop-bundle/pw-browsers

 */

const preparePackagedEnvironment = async (bundleRoot) => {

  if (isPlaywrightBrowsersReady(bundleRoot)) {

    return true;

  }



  const splash = new BrowserWindow({

    width: 580,

    height: 400,

    resizable: false,

    show: true,

    title: '首次环境准备',

    webPreferences: {

      nodeIntegration: false,

      contextIsolation: true,

    },

  });



  const splashPath = path.join(__dirname, 'setup-splash.html');

  await splash.loadFile(splashPath);



  const appendLog = (line) => {

    const escaped = JSON.stringify(line);

    splash.webContents

      .executeJavaScript(`document.getElementById('log').textContent += ${escaped}`)

      .catch(() => {});

  };



  const ok = await installPlaywrightBrowsers(bundleRoot, { onLog: appendLog });



  if (!splash.isDestroyed()) {

    splash.close();

  }



  if (!ok) {
    await dialog.showMessageBox({
      type: 'warning',
      title: '浏览器内核未就绪',
      message: 'Playwright Chromium 未能自动安装',
      detail:
        '登录与直连查询仍可使用。若需「浏览器/混合」批量模式，请联网后双击同目录「安装Playwright内核.bat」，或关闭本程序后重试。\n\n常见原因：网络不通、防火墙拦截、安装包不完整（缺少 resources\\desktop-bundle）。',
    });
  }

  return ok;
};



const createWindow = async () => {

  startRunner();

  const port = await waitForRunner();



  mainWindow = new BrowserWindow({

    width: 1360,

    height: 860,

    webPreferences: {

      nodeIntegration: false,

      contextIsolation: true,

    },

  });



  const indexHtml = path.join(__dirname, '..', 'dist', 'index.html');

  if (fs.existsSync(indexHtml)) {

    await mainWindow.loadFile(indexHtml, {

      query: { runtimeBase: `http://127.0.0.1:${port}` },

    });

  } else {

    mainWindow.loadURL(`data:text/html,<meta charset="utf-8"><p>未找到 dist/index.html，请先执行 npm run build</p>`);

    return;

  }



  mainWindow.webContents.executeJavaScript(

    `try{window.localStorage.setItem('qe-runtime-base','http://127.0.0.1:${port}');}catch(e){}`,

  );

};



app.whenReady().then(async () => {

  const bundle = getBundleRoot();

  if (app.isPackaged) {
    await preparePackagedEnvironment(bundle);
  }



  void createWindow();



  app.on('activate', () => {

    if (BrowserWindow.getAllWindows().length === 0) {

      void createWindow();

    }

  });

});



app.on('window-all-closed', () => {

  if (process.platform !== 'darwin') {

    app.quit();

  }

});



app.on('before-quit', () => {

  if (runnerChild && !runnerChild.killed) {

    try {

      runnerChild.kill('SIGTERM');

    } catch {

      // ignore

    }

  }

});

