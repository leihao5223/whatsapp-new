import { LogIn, Mail, Pause, Play, RefreshCw, Save, Upload, UserCircle, X } from 'lucide-react';
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  gmailBatchStart,
  gmailBatchStatus,
  gmailBatchStop,
  gmailFetchInbox,
  gmailGetAccounts,
  gmailLoginStart,
  gmailLogout,
  gmailPutAccounts,
} from './client';
import { parseAccountsFromText, validateAccountsText } from './parseAccounts';
import type { GmailAccountRow, GmailBatchTask, GmailInboxMessage, GmailSettings } from './types';

type Props = {
  runtimeBaseUrl: string;
  authToken?: string;
};

type StoredAccount = GmailAccountRow & { password?: string };

type InboxPopover = {
  accountId: string;
  email: string;
  loading: boolean;
  messages: GmailInboxMessage[];
  fetchedAt?: string;
  error?: string;
};

const defaultSettings: GmailSettings = {
  defaultDisplayName: '',
  delayBetweenSec: 5,
  updateAvatar: true,
  autoLoginOnSave: false,
};

const loginStatusLabel = (status?: string, sessionActive?: boolean) => {
  if (sessionActive || status === 'logged_in') {
    return '已登录';
  }
  if (status === 'logging_in') {
    return '登录中';
  }
  if (status === 'failed') {
    return '登录失败';
  }
  return '未登录';
};

export default function GmailBatchView({ runtimeBaseUrl, authToken }: Props) {
  const [section, setSection] = useState<'login' | 'deploy'>('login');
  const [accountsText, setAccountsText] = useState('');
  const [accounts, setAccounts] = useState<StoredAccount[]>([]);
  const [settings, setSettings] = useState<GmailSettings>(defaultSettings);
  const [hasAvatar, setHasAvatar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [activeTaskId, setActiveTaskId] = useState('');
  const [task, setTask] = useState<GmailBatchTask | null>(null);
  const [inboxPop, setInboxPop] = useState<InboxPopover | null>(null);
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

  const saveAccounts = async (autoLogin = false) => {
    setBusy(true);
    setNotice('');
    try {
      const res = await gmailPutAccounts(runtimeBaseUrl, authToken, {
        accountsText,
        settings,
        autoLogin: autoLogin || settings.autoLoginOnSave,
      });
      if (!res.success) {
        setNotice(res.error ?? '保存失败');
        return;
      }
      const taskId = (res as { autoLoginTaskId?: string }).autoLoginTaskId;
      if (taskId) {
        setActiveTaskId(taskId);
        setNotice('已保存，正在自动登录…');
        startPoll(taskId);
        const st = await gmailBatchStatus(runtimeBaseUrl, authToken, taskId);
        if (st.task) {
          setTask(st.task);
        }
      } else if (autoLogin || settings.autoLoginOnSave) {
        await startLogin();
      } else {
        setNotice('账号列表已保存');
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const startLogin = async (accountIds?: string[]) => {
    if (!authToken) {
      setNotice('请先登录控制台账号');
      return;
    }
    const check = validateAccountsText(accountsText);
    if (!check.ok) {
      setNotice(check.message);
      return;
    }
    setBusy(true);
    setNotice('正在保存账号并启动登录…');
    setTask({
      id: 'pending',
      kind: 'login',
      status: 'running',
      total: accountIds?.length ?? parseAccountsFromText(accountsText).length,
      processed: 0,
      success: 0,
      failed: 0,
      createdAt: new Date().toISOString(),
      logs: ['正在连接 Runner…'],
      records: [],
    });
    try {
      const putRes = await gmailPutAccounts(runtimeBaseUrl, authToken, { accountsText, settings });
      if (!putRes.success) {
        setNotice(putRes.error ?? '保存账号失败');
        return;
      }
      const res = await gmailLoginStart(runtimeBaseUrl, authToken, {
        accountIds,
        delayBetweenSec: settings.delayBetweenSec,
      });
      if (!res.success || !res.taskId) {
        setNotice(res.error ?? '启动登录失败（请确认 Runner 已启动且 Nginx 已转发 /gmail）');
        return;
      }
      setActiveTaskId(res.taskId);
      setNotice(`登录任务已启动（${res.total ?? 0} 个账号），请查看右侧执行日志`);
      startPoll(res.taskId);
      const st = await gmailBatchStatus(runtimeBaseUrl, authToken, res.taskId);
      if (st.task) {
        setTask(st.task);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setNotice(`登录请求失败：${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const openInbox = async (row: StoredAccount) => {
    const loggedIn = row.sessionActive || row.loginStatus === 'logged_in';
    if (!loggedIn) {
      setNotice(`请先登录：${row.email}`);
      return;
    }
    setInboxPop({
      accountId: row.id,
      email: row.email,
      loading: true,
      messages: [],
    });
    const res = await gmailFetchInbox(runtimeBaseUrl, authToken, row.id);
    if (!res.success || !res.inbox) {
      setInboxPop((p) =>
        p
          ? {
              ...p,
              loading: false,
              error: res.error ?? '无法加载收件箱',
            }
          : null,
      );
      return;
    }
    setInboxPop({
      accountId: row.id,
      email: res.email ?? row.email,
      loading: false,
      messages: res.inbox.messages,
      fetchedAt: res.inbox.fetchedAt,
    });
  };

  const refreshInbox = async () => {
    if (!inboxPop) {
      return;
    }
    const row = accounts.find((a) => a.id === inboxPop.accountId);
    if (row) {
      await openInbox(row);
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
          setNotice('头像已上传');
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

  const startBatch = async () => {
    setBusy(true);
    setNotice('');
    try {
      await gmailPutAccounts(runtimeBaseUrl, authToken, { accountsText, settings });
      const res = await gmailBatchStart(runtimeBaseUrl, authToken, {
        newDisplayName: settings.defaultDisplayName,
        delayBetweenSec: settings.delayBetweenSec,
        updateAvatar: settings.updateAvatar,
      });
      if (!res.success || !res.taskId) {
        setNotice(res.error ?? '启动批量任务失败');
        return;
      }
      setActiveTaskId(res.taskId);
      setNotice(`证书部署任务已启动（${res.total ?? 0} 个账号）`);
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
          <button
            type="button"
            className={`gmail-tab ${section === 'login' ? 'gmail-tab--active' : ''}`}
            onClick={() => setSection('login')}
          >
            邮箱登录
          </button>
          <button
            type="button"
            className={`gmail-tab ${section === 'deploy' ? 'gmail-tab--active' : ''}`}
            onClick={() => setSection('deploy')}
          >
            批量部署证书
          </button>
        </div>
      </header>

      <div className="gmail-grid">
        <section className="gmail-panel gmail-panel--wide">
          <header className="gmail-panel__head">
            <UserCircle size={18} />
            <h2>账号列表</h2>
            {section === 'login' ? (
              <div className="gmail-panel__head-actions action-row">
                <button type="button" className="soft-button" disabled={busy || !!running} onClick={() => void startLogin()}>
                  <LogIn size={16} /> 批量登录
                </button>
              </div>
            ) : null}
          </header>
          <div className="gmail-panel__body">
            <p className="gmail-hint">
              每行：<code>邮箱[TAB]密码</code> 或 <code>邮箱 密码</code>（空格也可）。保存后登录；<strong>点击已登录邮箱</strong>看收件箱。
            </p>
            <textarea
              className="batch-input gmail-accounts-text"
              value={accountsText}
              onChange={(e) => setAccountsText(e.target.value)}
              placeholder={'user1@gmail.com\tpassword\nuser2@gmail.com\tpassword2'}
              spellCheck={false}
            />
            <div className="action-row">
              <button type="button" className="soft-button" disabled={busy} onClick={() => void saveAccounts(false)}>
                <Save size={16} /> 保存列表
              </button>
              {section === 'login' ? (
                <>
                  <button type="button" className="run-button" disabled={busy} onClick={() => void saveAccounts(true)}>
                    <LogIn size={16} /> 保存并自动登录
                  </button>
                  <label className="landing-check gmail-inline-check">
                    <input
                      type="checkbox"
                      checked={Boolean(settings.autoLoginOnSave)}
                      onChange={(e) => setSettings((s) => ({ ...s, autoLoginOnSave: e.target.checked }))}
                    />
                    <span>每次保存后自动登录</span>
                  </label>
                </>
              ) : null}
            </div>

            {accounts.length > 0 ? (
              <div className="table-wrap gmail-accounts-table">
                <table className="gmail-account-click-table">
                  <thead>
                    <tr>
                      <th>邮箱</th>
                      <th>登录状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((row) => {
                      const loggedIn = row.sessionActive || row.loginStatus === 'logged_in';
                      return (
                        <tr
                          key={row.id}
                          className={loggedIn ? 'gmail-account-row gmail-account-row--in' : 'gmail-account-row'}
                          onClick={() => loggedIn && void openInbox(row)}
                        >
                          <td>
                            <span className="gmail-account-email">{row.email}</span>
                            {row.loginMessage ? <small>{row.loginMessage}</small> : null}
                          </td>
                          <td>
                            <span
                              className={`gmail-login-badge gmail-login-badge--${loggedIn ? 'in' : row.loginStatus || 'out'}`}
                            >
                              {loginStatusLabel(row.loginStatus, row.sessionActive)}
                            </span>
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className="soft-button gmail-row-btn"
                              disabled={busy || !!running}
                              onClick={() => void startLogin([row.id])}
                            >
                              登录
                            </button>
                            {loggedIn ? (
                              <button
                                type="button"
                                className="soft-button gmail-row-btn"
                                disabled={busy}
                                onClick={() => void gmailLogout(runtimeBaseUrl, authToken, row.id).then(() => load())}
                              >
                                退出
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </section>

        {section === 'deploy' ? (
          <section className="gmail-panel">
            <header className="gmail-panel__head">
              <h2>批量部署证书</h2>
            </header>
            <div className="gmail-panel__body landing-settings-stack">
              <label className="landing-field-label">目标显示名称</label>
              <input
                className="landing-glass-control"
                value={settings.defaultDisplayName}
                onChange={(e) => setSettings((s) => ({ ...s, defaultDisplayName: e.target.value }))}
                placeholder="例如：中美国金集团"
              />
              <label className="landing-field-label">批量头像（可选）</label>
              <div className="action-row">
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={(e) => void onAvatarFile(e)}
                />
                <button type="button" className="soft-button" disabled={busy} onClick={() => avatarInputRef.current?.click()}>
                  <Upload size={16} /> {hasAvatar ? '更换头像' : '上传头像'}
                </button>
              </div>
              <label className="landing-check">
                <input
                  type="checkbox"
                  checked={settings.updateAvatar}
                  onChange={(e) => setSettings((s) => ({ ...s, updateAvatar: e.target.checked }))}
                />
                <span>同时上传头像</span>
              </label>
              <label className="landing-field-label">账号间隔（秒）</label>
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
              <div className="action-row">
                <button type="button" className="run-button" disabled={busy || !!running} onClick={() => void startBatch()}>
                  <Play size={16} /> 批量部署证书
                </button>
                <button type="button" className="soft-button" disabled={busy || !running} onClick={() => void stopBatch()}>
                  <Pause size={16} /> 停止
                </button>
              </div>
            </div>
          </section>
        ) : (
          <section className="gmail-panel">
            <header className="gmail-panel__head">
              <h2>登录说明</h2>
            </header>
            <div className="gmail-panel__body">
              <ul className="gmail-hint gmail-hint-list">
                <li>填写邮箱和密码后，点「登录」即可，系统会在后台自动打开 Gmail 并完成登录。</li>
                <li>您无需安装浏览器，也无需任何额外设置。</li>
                <li>登录成功显示「已登录」，点击邮箱行可查看收件箱。</li>
                <li>若账号开启了短信/App 二次验证，需先在网页正常登录一次该邮箱。</li>
              </ul>
            </div>
          </section>
        )}

        <section className="gmail-panel gmail-panel--log">
          <header className="gmail-panel__head">
            <h2>执行日志</h2>
            {task ? (
              <span className="gmail-task-pill">
                {task.kind === 'login' ? '登录' : '部署'} · {task.status} · {task.processed}/{task.total}
              </span>
            ) : null}
          </header>
          <div className="gmail-panel__body">
            {task?.currentEmail ? <p className="gmail-hint">当前：{task.currentEmail}</p> : null}
            <pre className="batch-input batch-input--results gmail-log">
              {task?.logs?.length ? task.logs.join('\n') : '暂无任务日志'}
            </pre>
          </div>
        </section>
      </div>

      {inboxPop ? (
        <div className="gmail-inbox-popover" role="dialog" aria-label="收件箱">
          <header className="gmail-inbox-popover__head">
            <div>
              <strong>{inboxPop.email}</strong>
              <span className="gmail-hint">收件箱</span>
            </div>
            <div className="action-row">
              <button type="button" className="soft-button" disabled={inboxPop.loading} onClick={() => void refreshInbox()}>
                <RefreshCw size={14} />
              </button>
              <button type="button" className="soft-button" onClick={() => setInboxPop(null)}>
                <X size={14} />
              </button>
            </div>
          </header>
          <div className="gmail-inbox-popover__body">
            {inboxPop.loading ? <p className="gmail-hint">正在加载收件箱…</p> : null}
            {inboxPop.error ? <p className="gmail-hint gmail-hint--error">{inboxPop.error}</p> : null}
            {!inboxPop.loading && !inboxPop.error && inboxPop.messages.length === 0 ? (
              <p className="gmail-hint">暂无邮件或页面结构已变化</p>
            ) : null}
            <ul className="gmail-inbox-list">
              {inboxPop.messages.map((m, i) => (
                <li key={`${m.subject}-${i}`} className={m.unread ? 'gmail-inbox-item gmail-inbox-item--unread' : 'gmail-inbox-item'}>
                  <div className="gmail-inbox-item__top">
                    <span className="gmail-inbox-item__sender">{m.sender}</span>
                    <span className="gmail-inbox-item__time">{m.time}</span>
                  </div>
                  <strong className="gmail-inbox-item__subject">{m.subject}</strong>
                  {m.snippet ? <p className="gmail-inbox-item__snippet">{m.snippet}</p> : null}
                </li>
              ))}
            </ul>
            {inboxPop.fetchedAt ? (
              <p className="gmail-hint gmail-inbox-fetched">更新于 {new Date(inboxPop.fetchedAt).toLocaleString()}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
