import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { modifyGmailProfile } from './gmail-profile-runner.mjs';

/** @typedef {{ userId: string; username: string; role: string }} AuthCtx */

const gmailBatchTasks = new Map();

const sanitizeUserId = (userId) => String(userId ?? '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown';

const getGmailRoot = (projectRoot) =>
  (process.env.QE_GMAIL_DATA_DIR && String(process.env.QE_GMAIL_DATA_DIR).trim()) ||
  join(projectRoot, '.cache', 'gmail');

const userJsonPath = (root, userId) => join(root, `${sanitizeUserId(userId)}.json`);

const userDir = (root, userId) => join(root, sanitizeUserId(userId));

const userAvatarPath = (root, userId) => join(userDir(root, userId), 'batch-avatar.png');

const profilesRoot = (root, userId) => join(userDir(root, userId), 'browser-profiles');

const defaultDoc = (userId) => ({
  version: 1,
  userId,
  updatedAt: new Date().toISOString(),
  accounts: [],
  settings: {
    defaultDisplayName: '',
    delayBetweenSec: 5,
    updateAvatar: true,
    headless: true,
  },
});

const parseAccountsText = (text) => {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const accounts = [];
  for (const line of lines) {
    const parts = line.split(/[\t,|]/).map((p) => p.trim());
    const email = parts[0];
    const password = parts[1] ?? '';
    if (!email || !email.includes('@')) {
      continue;
    }
    accounts.push({
      id: `acc_${randomBytes(4).toString('hex')}`,
      email,
      password,
      note: parts[2] ?? '',
      lastStatus: '',
      lastMessage: '',
      lastRunAt: '',
    });
  }
  return accounts;
};

const loadDoc = async (root, userId) => {
  const path = userJsonPath(root, userId);
  try {
    const raw = await readFile(path, 'utf8');
    const doc = JSON.parse(raw);
    if (!doc.settings) {
      doc.settings = defaultDoc(userId).settings;
    }
    if (!Array.isArray(doc.accounts)) {
      doc.accounts = [];
    }
    return doc;
  } catch {
    return defaultDoc(userId);
  }
};

const saveDoc = async (root, doc) => {
  await mkdir(root, { recursive: true });
  doc.updatedAt = new Date().toISOString();
  await writeFile(userJsonPath(root, doc.userId), JSON.stringify(doc, null, 2), 'utf8');
};

const createGmailBatchTask = (userId, total) => {
  const id = `gmail-batch-${Date.now()}-${randomBytes(3).toString('hex')}`;
  const task = {
    id,
    ownerUserId: userId,
    status: 'queued',
    createdAt: new Date().toISOString(),
    startedAt: '',
    finishedAt: '',
    total,
    processed: 0,
    success: 0,
    failed: 0,
    cancelled: false,
    currentEmail: '',
    logs: [],
    records: [],
    error: '',
  };
  gmailBatchTasks.set(id, task);
  return task;
};

const pushLog = (task, message) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${message}`;
  task.logs.push(line);
  if (task.logs.length > 200) {
    task.logs.shift();
  }
};

/**
 * @param {object} opts
 * @returns {Promise<boolean>}
 */
export async function handleGmailRequest({
  req,
  res,
  pathname,
  method,
  readBody,
  sendJson,
  requireBatchAuth,
  projectRoot,
}) {
  if (!pathname.startsWith('/gmail/')) {
    return false;
  }

  const auth = requireBatchAuth(req, res, { roles: ['super_admin', 'sub_user'] });
  if (!auth) {
    return true;
  }

  const root = getGmailRoot(projectRoot);
  const userId = auth.userId;

  if (method === 'GET' && pathname === '/gmail/accounts') {
    const doc = await loadDoc(root, userId);
    sendJson(res, 200, {
      success: true,
      data: {
        accounts: doc.accounts,
        settings: doc.settings,
        updatedAt: doc.updatedAt,
        hasAvatar: existsSync(userAvatarPath(root, userId)),
      },
    });
    return true;
  }

  if (method === 'PUT' && pathname === '/gmail/accounts') {
    const body = JSON.parse((await readBody(req)) || '{}');
    const doc = await loadDoc(root, userId);

    if (typeof body.accountsText === 'string') {
      const parsed = parseAccountsText(body.accountsText);
      if (parsed.length) {
        const byEmail = new Map(doc.accounts.map((a) => [String(a.email).toLowerCase(), a]));
        doc.accounts = parsed.map((p) => {
          const old = byEmail.get(p.email.toLowerCase());
          if (!old) {
            return p;
          }
          return {
            ...old,
            email: p.email,
            password: p.password || old.password,
            note: p.note || old.note,
          };
        });
      }
    } else if (Array.isArray(body.accounts)) {
      doc.accounts = body.accounts
        .map((row) => ({
          id: String(row.id ?? `acc_${randomBytes(4).toString('hex')}`),
          email: String(row.email ?? '').trim(),
          password: String(row.password ?? ''),
          note: String(row.note ?? '').slice(0, 200),
          lastStatus: String(row.lastStatus ?? ''),
          lastMessage: String(row.lastMessage ?? '').slice(0, 500),
          lastRunAt: String(row.lastRunAt ?? ''),
        }))
        .filter((row) => row.email.includes('@'));
    }

    if (body.settings && typeof body.settings === 'object') {
      if (typeof body.settings.defaultDisplayName === 'string') {
        doc.settings.defaultDisplayName = body.settings.defaultDisplayName.slice(0, 120);
      }
      const delay = Number(body.settings.delayBetweenSec);
      if (Number.isFinite(delay) && delay >= 0) {
        doc.settings.delayBetweenSec = Math.min(120, Math.max(0, delay));
      }
      if (typeof body.settings.updateAvatar === 'boolean') {
        doc.settings.updateAvatar = body.settings.updateAvatar;
      }
      if (typeof body.settings.headless === 'boolean') {
        doc.settings.headless = body.settings.headless;
      }
    }

    if (typeof body.avatarPngBase64 === 'string' && body.avatarPngBase64.length > 20) {
      const b64 = body.avatarPngBase64.replace(/^data:image\/[a-z+]+;base64,/, '');
      let buf;
      try {
        buf = Buffer.from(b64, 'base64');
      } catch {
        sendJson(res, 400, { success: false, error: '头像 base64 无效' });
        return true;
      }
      if (buf.length > 3_000_000) {
        sendJson(res, 400, { success: false, error: '头像文件过大（最大约 3MB）' });
        return true;
      }
      await mkdir(userDir(root, userId), { recursive: true });
      await writeFile(userAvatarPath(root, userId), buf);
    }

    if (body.clearAvatar === true) {
      const ap = userAvatarPath(root, userId);
      if (existsSync(ap)) {
        const { unlink } = await import('node:fs/promises');
        await unlink(ap).catch(() => {});
      }
    }

    await saveDoc(root, doc);
    sendJson(res, 200, { success: true, data: doc });
    return true;
  }

  if (method === 'GET' && pathname === '/gmail/batch/list') {
    const tasks = [...gmailBatchTasks.values()]
      .filter((t) => t.ownerUserId === userId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 30)
      .map((t) => ({
        id: t.id,
        status: t.status,
        total: t.total,
        processed: t.processed,
        success: t.success,
        failed: t.failed,
        createdAt: t.createdAt,
        finishedAt: t.finishedAt,
      }));
    sendJson(res, 200, { success: true, tasks });
    return true;
  }

  const statusMatch = pathname.match(/^\/gmail\/batch\/([^/]+)\/status$/);
  if (method === 'GET' && statusMatch) {
    const task = gmailBatchTasks.get(statusMatch[1]);
    if (!task || task.ownerUserId !== userId) {
      sendJson(res, 404, { success: false, error: '任务不存在' });
      return true;
    }
    sendJson(res, 200, { success: true, task });
    return true;
  }

  const stopMatch = pathname.match(/^\/gmail\/batch\/([^/]+)\/stop$/);
  if (method === 'POST' && stopMatch) {
    const task = gmailBatchTasks.get(stopMatch[1]);
    if (!task || task.ownerUserId !== userId) {
      sendJson(res, 404, { success: false, error: '任务不存在' });
      return true;
    }
    task.cancelled = true;
    task.status = 'stopping';
    sendJson(res, 200, { success: true, task: { id: task.id, status: task.status } });
    return true;
  }

  if (method === 'POST' && pathname === '/gmail/batch/start') {
    const body = JSON.parse((await readBody(req)) || '{}');
    const doc = await loadDoc(root, userId);
    const newDisplayName = String(body.newDisplayName ?? doc.settings.defaultDisplayName ?? '').trim();
    if (!newDisplayName) {
      sendJson(res, 400, { success: false, error: '请填写目标显示名称' });
      return true;
    }

    const accountIds = Array.isArray(body.accountIds)
      ? body.accountIds.map((id) => String(id))
      : null;
    let targets = doc.accounts.filter((a) => a.email && a.password);
    if (accountIds?.length) {
      targets = targets.filter((a) => accountIds.includes(a.id));
    }
    if (!targets.length) {
      sendJson(res, 400, { success: false, error: '没有可执行的账号（请导入邮箱与密码）' });
      return true;
    }

    const delaySec = Number.isFinite(Number(body.delayBetweenSec))
      ? Math.min(120, Math.max(0, Number(body.delayBetweenSec)))
      : doc.settings.delayBetweenSec ?? 5;
    const headless = typeof body.headless === 'boolean' ? body.headless : doc.settings.headless !== false;
    const updateAvatar =
      typeof body.updateAvatar === 'boolean' ? body.updateAvatar : doc.settings.updateAvatar !== false;
    const avatarPath = updateAvatar && existsSync(userAvatarPath(root, userId)) ? userAvatarPath(root, userId) : '';

    const task = createGmailBatchTask(userId, targets.length);
    task.status = 'running';
    task.startedAt = new Date().toISOString();
    task.newDisplayName = newDisplayName;

    sendJson(res, 200, { success: true, taskId: task.id, total: targets.length });

    const profRoot = profilesRoot(root, userId);
    await mkdir(profRoot, { recursive: true });

    void (async () => {
      for (let i = 0; i < targets.length; i += 1) {
        if (task.cancelled) {
          task.status = 'cancelled';
          task.finishedAt = new Date().toISOString();
          pushLog(task, '批量任务已取消');
          return;
        }

        const acc = targets[i];
        task.currentEmail = acc.email;
        pushLog(task, `开始 ${i + 1}/${targets.length}: ${acc.email}`);

        try {
          const result = await modifyGmailProfile({
            email: acc.email,
            password: acc.password,
            newDisplayName,
            avatarPath,
            profilesRoot: profRoot,
            headless,
            shouldStop: () => task.cancelled,
            onLog: (msg) => pushLog(task, msg),
          });

          acc.lastStatus = 'success';
          acc.lastMessage = result.avatar?.message
            ? `名称已更新；头像：${result.avatar.message}`
            : '名称已更新';
          acc.lastRunAt = new Date().toISOString();
          task.success += 1;
          task.records.push({
            email: acc.email,
            ok: true,
            message: acc.lastMessage,
          });
          pushLog(task, `✅ ${acc.email} 完成`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          acc.lastStatus = 'failed';
          acc.lastMessage = msg.slice(0, 500);
          acc.lastRunAt = new Date().toISOString();
          task.failed += 1;
          task.records.push({ email: acc.email, ok: false, message: msg });
          pushLog(task, `❌ ${acc.email}: ${msg}`);
        }

        task.processed = i + 1;
        const idx = doc.accounts.findIndex((a) => a.id === acc.id);
        if (idx >= 0) {
          doc.accounts[idx] = { ...acc };
        }
        await saveDoc(root, doc);

        if (i < targets.length - 1 && delaySec > 0 && !task.cancelled) {
          pushLog(task, `等待 ${delaySec}s 后继续…`);
          await new Promise((r) => setTimeout(r, delaySec * 1000));
        }
      }

      task.status = task.cancelled ? 'cancelled' : 'completed';
      task.finishedAt = new Date().toISOString();
      task.currentEmail = '';
      pushLog(task, '全部账号处理完毕');
    })().catch((e) => {
      task.status = 'failed';
      task.error = e instanceof Error ? e.message : String(e);
      task.finishedAt = new Date().toISOString();
      pushLog(task, `批量异常: ${task.error}`);
    });

    return true;
  }

  sendJson(res, 404, { success: false, error: 'Not found' });
  return true;
}
