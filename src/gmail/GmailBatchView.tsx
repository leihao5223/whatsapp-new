import { Mail, Pause, Play, Save, Upload, UserCircle } from 'lucide-react';
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  gmailBatchStart,
  gmailBatchStatus,
  gmailBatchStop,
  gmailGetAccounts,
  gmailPutAccounts,
} from './client';
import type { GmailAccountRow, GmailBatchTask, GmailSettings } from './types';

type Props = {
  runtimeBaseUrl: string;
  authToken?: string;
};

type StoredAccount = GmailAccountRow & { password?: string };

const defaultSettings: GmailSettings = {
  defaultDisplayName: '',
  delayBetweenSec: 5,
  updateAvatar: true,
  headless: true,
};

export default function GmailBatchView({ runtimeBaseUrl, authToken }: Props) {
  const [accountsText, setAccountsText] = useState('');
  const [accounts, setAccounts] = useState<StoredAccount[]>([]);
  const [settings, setSettings] = useState<GmailSettings>(defaultSettings);
  const [hasAvatar, setHasAvatar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [activeTaskId, setActiveTaskId] = useState('');
  const [task, setTask] = useState<GmailBatchTask | null>(null);
  const pollRef = useRef<number | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!authToken) {
      return;
    }
    const res = await gmailGetAccounts(runtimeBaseUrl, authToken);
    if (!res.success || !res.data) {
      setNotice(res.error ?? '加载邮箱配置失败');
      return;
    }
    const rows = (res.data.accounts ?? []) as StoredAccount[];
    setAccounts(rows);
    setSettings({ ...defaultSettings, ...res.data.settings });
    setHasAvatar(Boolean(res.data.hasAvatar));
    if (rows.length) {
      setAccountsText(rows.map((a) => `${a.email}\t${a.password ?? ''}`).join('\n'));
    }
  }, [authToken, runtimeBaseUrl]);

  useEffect(() => {
    void load();
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
      }
    };
  }, [load]);

  const saveAccounts = async () => {
    setBusy(true);
    setNotice('');
    try {
      const res = await gmailPutAccounts(runtimeBaseUrl, authToken, {
        accountsText,
        settings,
      });
      if (!res.success) {
        setNotice(res.error ?? '保存失败');
        return;
      }
      setNotice('账号列表已保存');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const onAvatarFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result ?? '');
      setBusy(true);
      try {
        const res = await gmailPutAccounts(runtimeBaseUrl, authToken, {
          avatarPngBase64: dataUrl,
          settings,
        });
        if (res.success) {
          setHasAvatar(true);
          setNotice('头像已上传，批量任务将尝试同步到 Google 账号');
        } else {
          setNotice(res.error ?? '头像上传失败');
        }
      } finally {
        setBusy(false);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const startPoll = (taskId: string) => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
    }
    pollRef.current = window.setInterval(async () => {
      const res = await gmailBatchStatus(runtimeBaseUrl, authToken, taskId);
      if (res.success && res.task) {
        setTask(res.task);
        if (['completed', 'cancelled', 'failed'].includes(res.task.status)) {
          if (pollRef.current) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
          }
          void load();
        }
      }
    }, 2000);
  };

  const startBatch = async () => {
    setBusy(true);
    setNotice('');
    try {
      await gmailPutAccounts(runtimeBaseUrl, authToken, { accountsText, settings });
      const res = await gmailBatchStart(runtimeBaseUrl, authToken, {
        newDisplayName: settings.defaultDisplayName,
        delayBetweenSec: settings.delayBetweenSec,
        updateAvatar: settings.updateAvatar,
        headless: settings.headless,
      });
      if (!res.success || !res.taskId) {
        setNotice(res.error ?? '启动批量任务失败');
        return;
      }
      setActiveTaskId(res.taskId);
      setNotice(`批量任务已启动，共 ${res.total ?? 0} 个账号（Playwright 顺序执行）`);
      startPoll(res.taskId);
      const st = await gmailBatchStatus(runtimeBaseUrl, authToken, res.taskId);
      if (st.task) {
        setTask(st.task);
      }
    } finally {
      setBusy(false);
    }
  };

  const stopBatch = async () => {
    if (!activeTaskId) {
      return;
    }
    setBusy(true);
    try {
      await gmailBatchStop(runtimeBaseUrl, authToken, activeTaskId);
      setNotice('正在停止…');
    } finally {
      setBusy(false);
    }
  };

  const running = task && ['running', 'queued', 'stopping'].includes(task.status);

  return (
    <div className="gmail-page landing-page-root">
      {notice ? <p className="gmail-notice">{notice}</p> : null}

      <header className="gmail-toolbar">
        <div className="gmail-toolbar__title">
          <Mail size={20} />
          <div>
            <span className="gmail-toolbar__kicker">Gmail Hub</span>
            <strong>邮箱中心</strong>
          </div>
        </div>
        <div className="gmail-toolbar__tabs">
          <span className="gmail-tab gmail-tab--active">批量改资料</span>
          <span className="gmail-tab gmail-tab--soon" title="即将推出">
            登录 / 发件 / 回复
          </span>
        </div>
      </header>

      <div className="gmail-grid">
        <section className="gmail-panel">
          <header className="gmail-panel__head">
            <UserCircle size={18} />
            <h2>账号列表</h2>
          </header>
          <div className="gmail-panel__body">
            <p className="gmail-hint">
              每行一个账号，格式：<code>邮箱[TAB]密码</code> 或 <code>邮箱,密码</code>
            </p>
            <textarea
              className="batch-input gmail-accounts-text"
              value={accountsText}
              onChange={(e) => setAccountsText(e.target.value)}
              placeholder={'user1@gmail.com\tapp-password-here\nuser2@gmail.com\tpassword2'}
              spellCheck={false}
            />
            <div className="action-row">
              <button type="button" className="soft-button" disabled={busy} onClick={() => void saveAccounts()}>
                <Save size={16} /> 保存列表
              </button>
            </div>
            {accounts.length > 0 ? (
              <div className="table-wrap gmail-accounts-table">
                <table>
                  <thead>
                    <tr>
                      <th>邮箱</th>
                      <th>上次状态</th>
                      <th>备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((row) => (
                      <tr key={row.id}>
                        <td>{row.email}</td>
                        <td>
                          <span className={`gmail-status gmail-status--${row.lastStatus || 'idle'}`}>
                            {row.lastStatus || '—'}
                          </span>
                          {row.lastMessage ? <small>{row.lastMessage}</small> : null}
                        </td>
                        <td>{row.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </section>

        <section className="gmail-panel">
          <header className="gmail-panel__head">
            <h2>批量改显示名 / 头像</h2>
          </header>
          <div className="gmail-panel__body landing-settings-stack">
            <label className="landing-field-label">目标显示名称（所有账号统一修改）</label>
            <input
              className="landing-glass-control"
              value={settings.defaultDisplayName}
              onChange={(e) => setSettings((s) => ({ ...s, defaultDisplayName: e.target.value }))}
              placeholder="例如：中美国金集团"
            />

            <label className="landing-field-label">批量头像（PNG/JPG，可选）</label>
            <div className="action-row">
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="landing-glass-control--file"
                hidden
                onChange={(e) => void onAvatarFile(e)}
              />
              <button type="button" className="soft-button" disabled={busy} onClick={() => avatarInputRef.current?.click()}>
                <Upload size={16} /> {hasAvatar ? '更换头像' : '上传头像'}
              </button>
              {hasAvatar ? (
                <button
                  type="button"
                  className="soft-button"
                  disabled={busy}
                  onClick={() =>
                    void gmailPutAccounts(runtimeBaseUrl, authToken, { clearAvatar: true, settings }).then(() => {
                      setHasAvatar(false);
                      setNotice('已清除服务器上的头像文件');
                    })
                  }
                >
                  清除头像
                </button>
              ) : null}
            </div>

            <label className="landing-check">
              <input
                type="checkbox"
                checked={settings.updateAvatar}
                onChange={(e) => setSettings((s) => ({ ...s, updateAvatar: e.target.checked }))}
              />
              <span>同时尝试上传头像到 Google 账号（需已上传头像文件）</span>
            </label>

            <label className="landing-field-label">账号间隔（秒，降低风控）</label>
            <input
              type="number"
              min={0}
              max={120}
              className="landing-glass-control"
              value={settings.delayBetweenSec}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  delayBetweenSec: Math.min(120, Math.max(0, Number(e.target.value) || 0)),
                }))
              }
            />

            <label className="landing-check">
              <input
                type="checkbox"
                checked={settings.headless}
                onChange={(e) => setSettings((s) => ({ ...s, headless: e.target.checked }))}
              />
              <span>无头模式（服务器建议开启；本地调试可关闭以观察浏览器）</span>
            </label>

            <p className="gmail-hint">
              流程：独立浏览器配置 → 登录 Gmail → 设置页改姓名 → 尝试上传头像 → 退出。若开启 2FA，请先在对应 profile
              目录人工登录一次。
            </p>

            <div className="action-row">
              <button type="button" className="run-button" disabled={busy || !!running} onClick={() => void startBatch()}>
                <Play size={16} /> 开始批量改资料
              </button>
              <button type="button" className="soft-button" disabled={busy || !running} onClick={() => void stopBatch()}>
                <Pause size={16} /> 停止
              </button>
            </div>
          </div>
        </section>

        <section className="gmail-panel gmail-panel--log">
          <header className="gmail-panel__head">
            <h2>执行日志</h2>
            {task ? (
              <span className="gmail-task-pill">
                {task.status} · {task.processed}/{task.total} · 成功 {task.success} / 失败 {task.failed}
              </span>
            ) : null}
          </header>
          <div className="gmail-panel__body">
            {task?.currentEmail ? <p className="gmail-hint">当前：{task.currentEmail}</p> : null}
            <pre className="batch-input batch-input--results gmail-log">
              {task?.logs?.length ? task.logs.join('\n') : '暂无任务日志'}
            </pre>
            {task?.records?.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>邮箱</th>
                      <th>结果</th>
                      <th>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {task.records.map((r) => (
                      <tr key={r.email}>
                        <td>{r.email}</td>
                        <td>{r.ok ? '成功' : '失败'}</td>
                        <td>{r.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}