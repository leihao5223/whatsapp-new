import { Inbox, LogIn, Mail, Plus, Trash2, Upload, X } from 'lucide-react';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import {
  gmailAddPort,
  gmailBatchStart,
  gmailBatchStatus,
  gmailCheckNewMail,
  gmailDeleteAccount,
  gmailFetchInbox,
  gmailGetAccounts,
  gmailLoginAccount,
  gmailLoginStatus,
  gmailLogout,
  gmailPutAccounts,
  gmailVerifyAccount,
} from './client';
import type { GmailAccountRow, GmailInboxMessage, GmailSettings } from './types';

type Props = {
  runtimeBaseUrl: string;
  authToken?: string;
};

type LocalAccount = GmailAccountRow & {
  password?: string;
  _localEmail?: string;
  _localPassword?: string;
};

type VerifyModal = {
  accountId: string;
  email: string;
  status: string;
  hint: string;
};

type InboxPopover = {
  accountId: string;
  email: string;
  loading: boolean;
  messages: GmailInboxMessage[];
  error?: string;
};

const defaultSettings: GmailSettings = {
  defaultDisplayName: '',
  delayBetweenSec: 5,
  updateAvatar: true,
};

const isLoggedIn = (a: LocalAccount) => a.sessionActive || a.loginStatus === 'logged_in';

export default function GmailBatchView({ runtimeBaseUrl, authToken }: Props) {
  const [accounts, setAccounts] = useState<LocalAccount[]>([]);
  const [settings, setSettings] = useState<GmailSettings>(defaultSettings);
  const [hasAvatar, setHasAvatar] = useState(false);
  const [notice, setNotice] = useState('');
  const [section, setSection] = useState<'ports' | 'deploy'>('ports');
  const [verifyModal, setVerifyModal] = useState<VerifyModal | null>(null);
  const [inboxPop, setInboxPop] = useState<InboxPopover | null>(null);
  const [loggingIds, setLoggingIds] = useState<Set<string>>(new Set());
  const pollLoginRef = useRef<number | null>(null);
  const pollMailRef = useRef<number | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!authToken) {
      return;
    }
    const res = await gmailGetAccounts(runtimeBaseUrl, authToken);
    if (!res.success || !res.data) {
      setNotice(res.error ?? '加载失败');
      return;
    }
    const rows = (res.data.accounts ?? []).map((a) => ({
      ...a,
      _localEmail: a.email,
      _localPassword: a.password ?? '',
    }));
    setAccounts(rows);
    setSettings({ ...defaultSettings, ...res.data.settings });
    setHasAvatar(Boolean(res.data.hasAvatar));
    if (!rows.length) {
      await gmailAddPort(runtimeBaseUrl, authToken);
      const again = await gmailGetAccounts(runtimeBaseUrl, authToken);
      if (again.success && again.data?.accounts) {
        setAccounts(
          again.data.accounts.map((a) => ({
            ...a,
            _localEmail: a.email,
            _localPassword: a.password ?? '',
          })),
        );
      }
    }
  }, [authToken, runtimeBaseUrl]);

  useEffect(() => {
    void load();
    return () => {
      if (pollLoginRef.current) {
        window.clearInterval(pollLoginRef.current);
      }
      if (pollMailRef.current) {
        window.clearInterval(pollMailRef.current);
      }
    };
  }, [load]);

  useEffect(() => {
    if (pollMailRef.current) {
      window.clearInterval(pollMailRef.current);
    }
    pollMailRef.current = window.setInterval(() => {
      if (!authToken) {
        return;
      }
      void gmailCheckNewMail(runtimeBaseUrl, authToken).then((res) => {
        if (!res.success || !res.accounts) {
          return;
        }
        setAccounts((prev) =>
          prev.map((a) => {
            const hit = res.accounts?.find((x) => x.id === a.id);
            if (!hit) {
              return a;
            }
            return { ...a, hasNewMail: hit.hasNewMail, inboxUnreadCount: hit.unread };
          }),
        );
      });
    }, 45_000);
    return () => {
      if (pollMailRef.current) {
        window.clearInterval(pollMailRef.current);
      }
    };
  }, [authToken, runtimeBaseUrl]);

  const stopLoginPoll = () => {
    if (pollLoginRef.current) {
      window.clearInterval(pollLoginRef.current);
      pollLoginRef.current = null;
    }
  };

  const pollLogin = (accountId: string) => {
    stopLoginPoll();
    pollLoginRef.current = window.setInterval(async () => {
      const st = await gmailLoginStatus(runtimeBaseUrl, authToken, accountId);
      if (!st.success) {
        return;
      }
      setAccounts((prev) =>
        prev.map((a) =>
          a.id === accountId
            ? {
                ...a,
                ...(st.account ?? {}),
                loginStatus: st.status,
                loginMessage: st.hint,
                sessionActive: st.sessionActive,
              }
            : a,
        ),
      );
      if (st.status === 'needs_code' || st.status === 'needs_approve') {
        const acc = accounts.find((a) => a.id === accountId);
        setVerifyModal({
          accountId,
          email: acc?.email ?? acc?._localEmail ?? '',
          status: st.status,
          hint: st.hint,
        });
      }
      if (st.status === 'logged_in' || st.status === 'failed') {
        setLoggingIds((s) => {
          const n = new Set(s);
          n.delete(accountId);
          return n;
        });
        setVerifyModal((m) => (m?.accountId === accountId ? null : m));
        stopLoginPoll();
        if (st.status === 'logged_in') {
          setNotice(`${st.account?.email ?? '邮箱'} 登录成功`);
        } else {
          setNotice(st.hint || '登录失败');
        }
      }
    }, 2000);
  };

  const loginPort = async (acc: LocalAccount) => {
    const email = (acc._localEmail ?? acc.email).trim();
    const password = acc._localPassword ?? acc.password ?? '';
    if (!email.includes('@') || !password) {
      setNotice('请填写邮箱和密码');
      return;
    }
    setLoggingIds((s) => new Set(s).add(acc.id));
    setNotice(`正在登录 ${email}…`);
    const res = await gmailLoginAccount(runtimeBaseUrl, authToken, acc.id, { email, password });
    setAccounts((prev) =>
      prev.map((a) =>
        a.id === acc.id
          ? {
              ...a,
              email,
              password,
              _localEmail: email,
              _localPassword: password,
              ...(res.account ?? {}),
              loginStatus: res.status,
              loginMessage: res.hint,
              sessionActive: res.sessionActive,
            }
          : a,
      ),
    );
    if (res.status === 'logged_in') {
      setLoggingIds((s) => {
        const n = new Set(s);
        n.delete(acc.id);
        return n;
      });
      setNotice('登录成功');
      return;
    }
    if (res.status === 'needs_code' || res.status === 'needs_approve') {
      setVerifyModal({ accountId: acc.id, email, status: res.status, hint: res.hint });
      pollLogin(acc.id);
      return;
    }
    if (res.status === 'logging_in') {
      pollLogin(acc.id);
      return;
    }
    setLoggingIds((s) => {
      const n = new Set(s);
      n.delete(acc.id);
      return n;
    });
    setNotice(res.hint || res.error || '登录失败');
  };

  const openInbox = async (acc: LocalAccount) => {
    if (!isLoggedIn(acc)) {
      setNotice('请先登录');
      return;
    }
    setInboxPop({
      accountId: acc.id,
      email: acc.email,
      loading: true,
      messages: [],
    });
    const res = await gmailFetchInbox(runtimeBaseUrl, authToken, acc.id);
    if (!res.success || !res.inbox) {
      setInboxPop((p) => (p ? { ...p, loading: false, error: res.error ?? '加载收件箱失败' } : null));
      return;
    }
    setAccounts((prev) => prev.map((a) => (a.id === acc.id ? { ...a, hasNewMail: false } : a)));
    setInboxPop({
      accountId: acc.id,
      email: res.email ?? acc.email,
      loading: false,
      messages: res.inbox.messages,
    });
  };

  const addPort = async () => {
    const res = await gmailAddPort(runtimeBaseUrl, authToken);
    if (res.success && res.account) {
      setAccounts((prev) => [
        ...prev,
        { ...res.account, _localEmail: '', _localPassword: '' } as LocalAccount,
      ]);
    }
  };

  const removePort = async (id: string) => {
    await gmailDeleteAccount(runtimeBaseUrl, authToken, id);
    setAccounts((prev) => prev.filter((a) => a.id !== id));
  };

  const emptySlots = Math.max(0, 12 - accounts.length);

  return (
    <div className="gmail-page gmail-page--ports landing-page-root">
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
            className={`gmail-tab ${section === 'ports' ? 'gmail-tab--active' : ''}`}
            onClick={() => setSection('ports')}
          >
            邮箱端口
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

      {section === 'ports' ? (
        <section className="panel settings-panel gmail-ports-panel">
          <div className="panel__header compact">
            <div>
              <p className="section-kicker">邮箱端口</p>
              <h2>每个邮箱独立登录，登录后可查看收件箱</h2>
            </div>
            <button type="button" className="run-button" onClick={() => void addPort()}>
              <Plus size={16} /> 添加邮箱端口
            </button>
          </div>
          <div className="port-grid-20 gmail-port-grid">
            {accounts.map((acc, index) => {
              const logged = isLoggedIn(acc);
              const logging = loggingIds.has(acc.id);
              const alert = logged && acc.hasNewMail;
              return (
                <div
                  key={acc.id}
                  className={`port-card gmail-port-card ${logged ? 'gmail-port-card--in' : ''} ${alert ? 'gmail-port-card--new-mail' : ''}`}
                >
                  <div className="port-card__online">
                    <span className={`pulse-dot ${logged ? '' : 'pulse-dot--off'}`} />
                    <div>
                      <strong>{logged ? '已登录' : logging ? '登录中…' : '未登录'}</strong>
                      <small>{acc.loginMessage || 'Google 邮箱'}</small>
                    </div>
                  </div>
                  <div className="port-card__head">
                    <strong>邮箱 #{index + 1}</strong>
                  </div>

                  {logged ? (
                    <>
                      <div className="gmail-port-email">{acc.email}</div>
                      <button type="button" className="run-button gmail-inbox-btn" onClick={() => void openInbox(acc)}>
                        <Inbox size={16} /> 收件箱
                        {acc.hasNewMail ? <span className="gmail-new-dot">新</span> : null}
                      </button>
                      <div className="port-card__actions">
                        <button
                          type="button"
                          className="soft-button danger"
                          onClick={() => void gmailLogout(runtimeBaseUrl, authToken, acc.id).then(() => load())}
                        >
                          退出
                        </button>
                        <button type="button" className="soft-button danger" onClick={() => void removePort(acc.id)}>
                          <Trash2 size={14} /> 删除
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <input
                        className="port-card__input"
                        type="email"
                        placeholder="Gmail 地址"
                        value={acc._localEmail ?? ''}
                        onChange={(e) =>
                          setAccounts((prev) =>
                            prev.map((a) => (a.id === acc.id ? { ...a, _localEmail: e.target.value } : a)),
                          )
                        }
                      />
                      <input
                        className="port-card__input"
                        type="password"
                        placeholder="密码"
                        value={acc._localPassword ?? ''}
                        onChange={(e) =>
                          setAccounts((prev) =>
                            prev.map((a) => (a.id === acc.id ? { ...a, _localPassword: e.target.value } : a)),
                          )
                        }
                      />
                      <div className="port-card__actions">
                        <button
                          type="button"
                          className="run-button"
                          disabled={logging}
                          onClick={() => void loginPort(acc)}
                        >
                          <LogIn size={14} /> 登录
                        </button>
                        <button type="button" className="soft-button danger" onClick={() => void removePort(acc.id)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
            {Array.from({ length: emptySlots }).map((_, i) => (
              <button key={`empty-${i}`} type="button" className="port-card port-card--empty" onClick={() => void addPort()}>
                <Plus size={18} />
                添加邮箱
              </button>
            ))}
          </div>
        </section>
      ) : (
        <DeployPanel
          runtimeBaseUrl={runtimeBaseUrl}
          authToken={authToken}
          settings={settings}
          setSettings={setSettings}
          hasAvatar={hasAvatar}
          setHasAvatar={setHasAvatar}
          avatarInputRef={avatarInputRef}
          accounts={accounts.filter(isLoggedIn)}
        />
      )}

      {verifyModal ? (
        <VerifyModalView
          modal={verifyModal}
          onClose={() => setVerifyModal(null)}
          onSubmitCode={async (code) => {
            const res = await gmailVerifyAccount(runtimeBaseUrl, authToken, verifyModal.accountId, { code });
            if (res.status === 'logged_in') {
              setVerifyModal(null);
              stopLoginPoll();
              void load();
            } else {
              setVerifyModal((m) => (m ? { ...m, status: res.status, hint: res.hint } : null));
            }
          }}
          onApprove={async () => {
            const res = await gmailVerifyAccount(runtimeBaseUrl, authToken, verifyModal.accountId, { approved: true });
            if (res.status === 'logged_in') {
              setVerifyModal(null);
              stopLoginPoll();
              void load();
            } else {
              setVerifyModal((m) => (m ? { ...m, status: res.status, hint: res.hint } : null));
              pollLogin(verifyModal.accountId);
            }
          }}
        />
      ) : null}

      {inboxPop ? (
        <div className="gmail-inbox-popover" role="dialog">
          <header className="gmail-inbox-popover__head">
            <div>
              <strong>{inboxPop.email}</strong>
              <span className="gmail-hint">收件箱</span>
            </div>
            <button type="button" className="soft-button" onClick={() => setInboxPop(null)}>
              <X size={14} />
            </button>
          </header>
          <div className="gmail-inbox-popover__body">
            {inboxPop.loading ? <p className="gmail-hint">加载中…</p> : null}
            {inboxPop.error ? <p className="gmail-hint gmail-hint--error">{inboxPop.error}</p> : null}
            <ul className="gmail-inbox-list">
              {inboxPop.messages.map((m, i) => (
                <li key={`${m.subject}-${i}`} className={m.unread ? 'gmail-inbox-item gmail-inbox-item--unread' : 'gmail-inbox-item'}>
                  <div className="gmail-inbox-item__top">
                    <span>{m.sender}</span>
                    <span>{m.time}</span>
                  </div>
                  <strong>{m.subject}</strong>
                  {m.snippet ? <p>{m.snippet}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function VerifyModalView({
  modal,
  onClose,
  onSubmitCode,
  onApprove,
}: {
  modal: VerifyModal;
  onClose: () => void;
  onSubmitCode: (code: string) => void;
  onApprove: () => void;
}) {
  const [code, setCode] = useState('');
  return (
    <div className="gmail-verify-overlay">
      <div className="gmail-verify-modal">
        <h3>需要验证 — {modal.email}</h3>
        <p className="gmail-hint">{modal.hint}</p>
        {modal.status === 'needs_code' ? (
          <>
            <input
              className="landing-glass-control"
              placeholder="输入验证码"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button type="button" className="run-button" onClick={() => void onSubmitCode(code)}>
              提交验证码
            </button>
          </>
        ) : (
          <button type="button" className="run-button" onClick={() => void onApprove()}>
            我已在手机上点「允许」
          </button>
        )}
        <button type="button" className="soft-button" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  );
}

function DeployPanel({
  runtimeBaseUrl,
  authToken,
  settings,
  setSettings,
  hasAvatar,
  setHasAvatar,
  avatarInputRef,
  accounts,
}: {
  runtimeBaseUrl: string;
  authToken?: string;
  settings: GmailSettings;
  setSettings: (s: GmailSettings) => void;
  hasAvatar: boolean;
  setHasAvatar: (v: boolean) => void;
  avatarInputRef: RefObject<HTMLInputElement | null>;
  accounts: LocalAccount[];
}) {
  const [notice, setNotice] = useState('');
  const startDeploy = async () => {
    if (!settings.defaultDisplayName.trim()) {
      setNotice('请填写目标显示名称');
      return;
    }
    const res = await gmailBatchStart(runtimeBaseUrl, authToken, {
      newDisplayName: settings.defaultDisplayName,
      accountIds: accounts.map((a) => a.id),
      updateAvatar: settings.updateAvatar,
    });
    setNotice(res.success ? `已启动，${res.total ?? 0} 个已登录账号` : res.error ?? '启动失败');
  };
  return (
    <section className="gmail-panel" style={{ marginTop: 12 }}>
      <div className="gmail-panel__body landing-settings-stack">
        <p className="gmail-hint">仅对已登录的邮箱批量改显示名/头像（{accounts.length} 个）</p>
        <label className="landing-field-label">目标显示名称</label>
        <input
          className="landing-glass-control"
          value={settings.defaultDisplayName}
          onChange={(e) => setSettings({ ...settings, defaultDisplayName: e.target.value })}
        />
        <input ref={avatarInputRef} type="file" accept="image/*" hidden />
        <button type="button" className="soft-button" onClick={() => avatarInputRef.current?.click()}>
          <Upload size={16} /> {hasAvatar ? '已上传头像' : '上传头像'}
        </button>
        <button type="button" className="run-button" onClick={() => void startDeploy()}>
          批量部署证书
        </button>
        {notice ? <p className="gmail-notice">{notice}</p> : null}
      </div>
    </section>
  );
}
