import { Download, ChevronLeft, ChevronRight, Printer, Send, RefreshCw, Trash2, Upload } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildLandingHtml } from './buildHtml';
import {
  fetchLogoDataUrl,
  landingAddTemplateUrl,
  landingCaptureTemplate,
  landingDeleteTemplate,
  landingGetProfile,
  landingLayoutNext,
  landingLayoutPrev,
  landingPutProfile,
  landingPutSettings,
  landingSendNext,
  landingSendSimulate,
  landingUploadTemplateZip,
} from './client';
import { LANDING_GALLERY, LANDING_STYLE_IDS } from './templateCatalog';
import type { LandingButtonType, LandingDoc } from './types';

type Props = {
  runtimeBaseUrl: string;
  authToken?: string;
};

const joinRuntime = (base: string, path: string) => `${String(base).replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;

const posixZipEntryForUrl = (entry: string) =>
  String(entry || 'index.html')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join('/');

const defaultDoc = (): LandingDoc => ({
  version: 1,
  userId: '',
  updatedAt: '',
  profile: {
    projectName: '',
    companyType: '',
    buttonType: 'site',
    appDownloadUrl: '',
    serviceUrl: '',
    siteUrl: '',
    hasLogo: false,
  },
  settings: {
    pdfPresentation: false,
    randomStyle: true,
    lockTemplateId: '',
    usePlaceholderImages: false,
    domainsText: '',
    styleSendLimits: Object.fromEntries(LANDING_STYLE_IDS.map((id) => [id, 100])) as Record<string, number>,
  },
  runtime: {
    currentTemplateId: 'gallery-aurora',
    historyStack: [{ styleId: 'premium-scroll', seed: 10001 }],
    historyIndex: 0,
    styleSendUsed: Object.fromEntries(LANDING_STYLE_IDS.map((id) => [id, 0])) as Record<string, number>,
  },
  customTemplates: [],
});

export default function LandingPageView({ runtimeBaseUrl, authToken }: Props) {
  const [doc, setDoc] = useState<LandingDoc | null>(null);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [urlTplName, setUrlTplName] = useState('外链模板');
  const [urlTplUrl, setUrlTplUrl] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const zipTemplateInputRef = useRef<HTMLInputElement>(null);

  const customList = doc?.customTemplates ?? [];

  const selectedCustom = useMemo(
    () => doc?.customTemplates?.find((x) => x.id === doc?.runtime.currentTemplateId),
    [doc?.customTemplates, doc?.runtime.currentTemplateId],
  );
  const needsTemplateCapture = Boolean(selectedCustom && !selectedCustom.coverCaptured);

  const accentHex = useMemo(() => {
    const g = LANDING_GALLERY.find((item) => item.id === doc?.runtime.currentTemplateId);
    return g?.accent ?? '#22d3ee';
  }, [doc?.runtime.currentTemplateId]);

  const previewRemoteSrc = useMemo(() => {
    if (!authToken || !selectedCustom) {
      return null;
    }
    if (selectedCustom.source === 'url' && selectedCustom.remoteUrl) {
      return selectedCustom.remoteUrl;
    }
    if (selectedCustom.source === 'zip' && selectedCustom.entry) {
      const path = posixZipEntryForUrl(selectedCustom.entry);
      return `${joinRuntime(runtimeBaseUrl, `/landing/templates/${selectedCustom.id}/files/${path}`)}?access_token=${encodeURIComponent(authToken)}`;
    }
    return null;
  }, [authToken, runtimeBaseUrl, selectedCustom]);

  const refreshLogo = useCallback(async (cacheBust?: string) => {
    if (!authToken) {
      return;
    }
    const url = await fetchLogoDataUrl(runtimeBaseUrl, authToken, cacheBust);
    setLogoDataUrl(url);
  }, [authToken, runtimeBaseUrl]);

  const load = useCallback(async () => {
    if (!authToken) {
      setDoc(null);
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      const res = await landingGetProfile(runtimeBaseUrl, authToken);
      if (!res.success || !res.data) {
        setNotice(res.error ?? '加载失败');
        setDoc(defaultDoc());
        return;
      }
      setDoc(res.data);
      await refreshLogo();
    } finally {
      setBusy(false);
    }
  }, [authToken, refreshLogo, runtimeBaseUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const skipCaptureUntilReselect = useRef(false);
  useEffect(() => {
    skipCaptureUntilReselect.current = false;
  }, [doc?.runtime.currentTemplateId]);

  useEffect(() => {
    if (!authToken || !doc || !needsTemplateCapture || skipCaptureUntilReselect.current || !selectedCustom) {
      return;
    }
    let cancelled = false;
    setBusy(true);
    void (async () => {
      const r = await landingCaptureTemplate(runtimeBaseUrl, authToken, selectedCustom.id);
      if (cancelled) {
        return;
      }
      if (!r.success) {
        skipCaptureUntilReselect.current = true;
        setNotice(r.error ?? '首页截图失败，请换模板再选回重试');
        setBusy(false);
        return;
      }
      if (r.data?.doc) {
        setDoc(r.data.doc);
      } else {
        await load();
      }
      setBusy(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [authToken, doc, load, needsTemplateCapture, runtimeBaseUrl, selectedCustom]);

  const previewSrcDoc = useMemo(() => {
    if (!doc || previewRemoteSrc) {
      return '';
    }
    return buildLandingHtml({ doc, logoDataUrl, accentHex });
  }, [doc, logoDataUrl, accentHex, previewRemoteSrc]);

  const saveProfile = async (patch: Record<string, unknown>): Promise<boolean> => {
    if (!authToken || !doc) {
      return false;
    }
    setBusy(true);
    setNotice('');
    try {
      const res = await landingPutProfile(runtimeBaseUrl, authToken, patch);
      if (!res.success || !res.data) {
        setNotice(res.error ?? '保存失败');
        return false;
      }
      setDoc(res.data);
      await refreshLogo(String(res.data.updatedAt ?? Date.now()));
      return true;
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async (patch: Record<string, unknown>) => {
    if (!authToken || !doc) {
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      const res = await landingPutSettings(runtimeBaseUrl, authToken, patch);
      if (!res.success || !res.data) {
        setNotice(res.error ?? '保存失败');
        return;
      }
      setDoc(res.data);
    } finally {
      setBusy(false);
    }
  };

  const onLayoutNext = async () => {
    if (!authToken) {
      return;
    }
    setBusy(true);
    try {
      const res = await landingLayoutNext(runtimeBaseUrl, authToken);
      if (res.success && res.data?.doc) {
        setDoc(res.data.doc);
      } else {
        setNotice((res as { error?: string }).error ?? '切换失败');
      }
    } finally {
      setBusy(false);
    }
  };

  const onLayoutPrev = async () => {
    if (!authToken) {
      return;
    }
    setBusy(true);
    try {
      const res = await landingLayoutPrev(runtimeBaseUrl, authToken);
      if (res.success && res.data?.doc) {
        setDoc(res.data.doc);
      } else {
        setNotice((res as { error?: string }).error ?? '返回失败');
      }
    } finally {
      setBusy(false);
    }
  };

  const onPrint = () => {
    try {
      iframeRef.current?.contentWindow?.focus();
      iframeRef.current?.contentWindow?.print();
    } catch {
      setNotice('打印失败：浏览器阻止了跨域打印');
    }
  };

  const onExportHtml = () => {
    if (!doc) {
      return;
    }
    if (previewRemoteSrc) {
      setNotice('当前为上传 ZIP 或外链模板：请直接使用 ZIP 内源文件，或在目标站点另存页面。');
      return;
    }
    const html = buildLandingHtml({ doc, logoDataUrl, accentHex });
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `landing-${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onDeleteCurrentCustomTemplate = async () => {
    const t = selectedCustom;
    if (!t || !authToken) {
      return;
    }
    if (!window.confirm(`删除当前模板「${t.name}」？删除后不可恢复。`)) {
      return;
    }
    setBusy(true);
    setNotice('');
    const r = await landingDeleteTemplate(runtimeBaseUrl, authToken, t.id);
    if (!r.success || !r.data?.doc) {
      setNotice(r.error ?? '删除失败');
    } else {
      setDoc(r.data.doc);
      setNotice('已删除模板');
    }
    setBusy(false);
  };

  const onLogoFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const looksPng =
      file &&
      (file.type === 'image/png' ||
        file.type === 'image/x-png' ||
        file.type === 'application/x-png' ||
        (!file.type && /\.png$/i.test(file.name)));
    if (!file || !looksPng) {
      setNotice('请上传 PNG 图片（.png）；若已选 PNG 仍失败，请确认扩展名为 .png');
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = typeof reader.result === 'string' ? reader.result : '';
      const pure = base64.includes(',') ? base64.split(',')[1] ?? '' : base64;
      setLogoDataUrl(base64);
      const ok = await saveProfile({ logoPngBase64: pure });
      if (!ok) {
        await refreshLogo(String(Date.now()));
      }
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  if (!authToken) {
    return (
      <div className="page-stack">
        <section className="panel settings-panel">
          <div className="connector-note">请先登录后使用落地页生成。</div>
        </section>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="page-stack">
        <section className="panel settings-panel">
          <div className="connector-note">{busy ? '加载中…' : '无数据'}</div>
        </section>
      </div>
    );
  }

  const frame = doc.runtime.historyStack[doc.runtime.historyIndex] ?? doc.runtime.historyStack[0];

  return (
    <div className="landing-page-root">
      {notice ? <div className="connector-note landing-notice">{notice}</div> : null}

      <div className="landing-top-split">
        <section className="panel settings-panel landing-col landing-col--form">
          <div className="panel__header compact">
            <div>
              <p className="section-kicker">Content</p>
              <h2>文案与素材</h2>
            </div>
          </div>
          <div className="landing-generator-form">
            <div className="landing-glass-field">
              <label className="landing-field-label">项目名</label>
              <input value={doc.profile.projectName} onChange={(e) => setDoc({ ...doc, profile: { ...doc.profile, projectName: e.target.value } })} />
            </div>
            <div className="landing-glass-field">
              <label className="landing-field-label">公司类型</label>
              <input value={doc.profile.companyType} onChange={(e) => setDoc({ ...doc, profile: { ...doc.profile, companyType: e.target.value } })} />
            </div>
            <div className="landing-glass-field">
              <label className="landing-field-label">Logo（PNG）</label>
              <input type="file" accept="image/png,.png,application/x-png" onChange={(e) => void onLogoFile(e)} />
            </div>
            <div className="landing-glass-field">
              <label className="landing-field-label">按钮类型</label>
              <select
                value={doc.profile.buttonType}
                onChange={(e) =>
                  setDoc({
                    ...doc,
                    profile: { ...doc.profile, buttonType: e.target.value as LandingButtonType },
                  })
                }
              >
                <option value="app">APP 下载</option>
                <option value="service">跳转客服</option>
                <option value="site">跳转官网</option>
              </select>
              {doc.profile.buttonType === 'app' ? (
                <input
                  placeholder="应用包 / 商店链接"
                  value={doc.profile.appDownloadUrl}
                  onChange={(e) => setDoc({ ...doc, profile: { ...doc.profile, appDownloadUrl: e.target.value } })}
                />
              ) : null}
              {doc.profile.buttonType === 'service' ? (
                <input
                  placeholder="客服链接（WhatsApp / 企微等）"
                  value={doc.profile.serviceUrl}
                  onChange={(e) => setDoc({ ...doc, profile: { ...doc.profile, serviceUrl: e.target.value } })}
                />
              ) : null}
              {doc.profile.buttonType === 'site' ? (
                <input
                  placeholder="官网 URL"
                  value={doc.profile.siteUrl}
                  onChange={(e) => setDoc({ ...doc, profile: { ...doc.profile, siteUrl: e.target.value } })}
                />
              ) : null}
            </div>
          </div>
          <div className="action-row">
            <button type="button" className="run-button" disabled={busy} onClick={() => void saveProfile({ ...doc.profile })}>
              保存资料
            </button>
          </div>
        </section>

        <section className="panel settings-panel landing-col landing-col--preview">
          <div className="panel__header compact">
            <div>
              <p className="section-kicker">Preview</p>
              <h2>实时预览</h2>
            </div>
          </div>
          <p className="muted-copy landing-preview-meta">
            {selectedCustom ? (
              <>
                当前模板：<strong>{selectedCustom.name}</strong>（{selectedCustom.source === 'url' ? '外链复刻' : 'ZIP 包'}）
              </>
            ) : (
              <>
                当前版式：<strong>{frame.styleId}</strong> · seed {frame.seed}
              </>
            )}
          </p>
          <div className="landing-preview-frame-wrap landing-preview-frame-wrap--tall">
            {previewRemoteSrc ? (
              <iframe
                key={`ext-${selectedCustom?.id ?? 'x'}`}
                ref={iframeRef}
                className="landing-preview-frame"
                title="landing-preview"
                src={previewRemoteSrc}
                sandbox={
                  selectedCustom?.source === 'url'
                    ? 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals'
                    : 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals'
                }
                referrerPolicy="no-referrer"
              />
            ) : (
              <iframe
                key="sys"
                ref={iframeRef}
                className="landing-preview-frame"
                title="landing-preview"
                srcDoc={previewSrcDoc}
                sandbox="allow-same-origin allow-modals"
              />
            )}
          </div>
          <div className="landing-preview-toolbar">
            <button type="button" className="soft-button" disabled={busy || !!selectedCustom} onClick={() => void onLayoutPrev()}>
              <ChevronLeft size={16} /> 返回上一版式
            </button>
            <button type="button" className="run-button" disabled={busy || !!selectedCustom} onClick={() => void onLayoutNext()}>
              切换新版式 <ChevronRight size={16} />
            </button>
            {doc.settings.pdfPresentation ? (
              <button type="button" className="soft-button" onClick={() => onPrint()}>
                <Printer size={16} /> 打印 / 存 PDF
              </button>
            ) : null}
            <button type="button" className="soft-button" onClick={() => void onExportHtml()}>
              <Download size={16} /> 导出 HTML
            </button>
          </div>
        </section>

        <section className="panel settings-panel landing-col landing-col--settings">
          <div className="panel__header compact">
            <div>
              <p className="section-kicker">Settings</p>
              <h2>落地页设置</h2>
            </div>
          </div>
          <div className="landing-settings-stack">
            <label className="landing-check">
              <input type="checkbox" checked={doc.settings.pdfPresentation} onChange={(e) => setDoc({ ...doc, settings: { ...doc.settings, pdfPresentation: e.target.checked } })} />
              <span>以 PDF 展示（开启后出现「打印 / 存 PDF」）</span>
            </label>
            <label className="landing-check">
              <input type="checkbox" checked={doc.settings.randomStyle} onChange={(e) => setDoc({ ...doc, settings: { ...doc.settings, randomStyle: e.target.checked } })} />
              <span>随机样式（关闭则按顺序轮换）</span>
            </label>
            <label className="landing-field-label">指定当前样式（锁定版式 ID，留空则不锁）</label>
            <select
              value={doc.settings.lockTemplateId}
              onChange={(e) => setDoc({ ...doc, settings: { ...doc.settings, lockTemplateId: e.target.value } })}
            >
              <option value="">不锁定</option>
              {LANDING_STYLE_IDS.map((id) => (
                <option key={id} value={id}>
                  {id === 'premium-scroll' ? '典藏长页（高规格）' : id}
                </option>
              ))}
            </select>
            <label className="landing-check">
              <input
                type="checkbox"
                checked={doc.settings.usePlaceholderImages}
                onChange={(e) => setDoc({ ...doc, settings: { ...doc.settings, usePlaceholderImages: e.target.checked } })}
              />
              <span>使用外网占位图（Picsum，需联网）</span>
            </label>
            <label className="landing-field-label">每种样式发送次数上限</label>
            <div className="landing-limits-grid">
              {LANDING_STYLE_IDS.map((id) => (
                <div key={id} className="landing-limit-row">
                  <span>{id}</span>
                  <input
                    type="number"
                    min={0}
                    value={doc.settings.styleSendLimits[id] ?? 0}
                    onChange={(e) =>
                      setDoc({
                        ...doc,
                        settings: {
                          ...doc.settings,
                          styleSendLimits: { ...doc.settings.styleSendLimits, [id]: Number(e.target.value) },
                        },
                      })
                    }
                  />
                  <small>已发 {doc.runtime.styleSendUsed[id] ?? 0}</small>
                </div>
              ))}
            </div>
            <label className="landing-field-label">域名 / 泛域名仓库（每行一个，如 a.com 或 *.b.com）</label>
            <textarea
              className="batch-input"
              rows={5}
              value={doc.settings.domainsText}
              onChange={(e) => setDoc({ ...doc, settings: { ...doc.settings, domainsText: e.target.value } })}
            />
          </div>
          <div className="action-row landing-settings-actions">
            <button type="button" className="run-button" disabled={busy} onClick={() => void saveSettings({ ...doc.settings })}>
              保存设置
            </button>
            <button
              type="button"
              className="soft-button"
              disabled={busy}
              onClick={async () => {
                const r = await landingSendSimulate(runtimeBaseUrl, authToken);
                setNotice(r.success ? `模拟发送成功：${r.styleId} 已用 ${r.used}/${r.limit}` : r.error ?? '失败');
                void load();
              }}
            >
              <Send size={14} /> 模拟发送扣次
            </button>
            <button
              type="button"
              className="soft-button"
              disabled={busy}
              onClick={async () => {
                const r = await landingSendNext(runtimeBaseUrl, authToken);
                if (r.success) {
                  setNotice(`分配：${r.styleId} → ${r.virtualUrl || '(未配置域名)'} ；剩余 ${JSON.stringify(r.remainingByStyle ?? {})}`);
                } else {
                  setNotice(r.error ?? '分配失败');
                }
                void load();
              }}
            >
              <RefreshCw size={14} /> 群发取链（扣次）
            </button>
          </div>
        </section>
      </div>

      <section className="panel settings-panel landing-gallery">
        <div className="panel__header compact landing-gallery-header">
          <div>
            <p className="section-kicker">Gallery</p>
            <h2>模板图册</h2>
          </div>
          <div className="landing-gallery-header-actions">
            <input
              ref={zipTemplateInputRef}
              type="file"
              accept=".zip,application/zip"
              className="landing-gallery-file-hidden"
              aria-hidden
              tabIndex={-1}
              onChange={(e) => {
                void (async () => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file || !authToken) {
                    return;
                  }
                  setBusy(true);
                  setNotice('');
                  const r = await landingUploadTemplateZip(runtimeBaseUrl, authToken, file, file.name.replace(/\.zip$/i, ''));
                  if (!r.success || !r.data?.doc) {
                    setNotice(r.error ?? 'ZIP 上传失败');
                  } else {
                    setDoc(r.data.doc);
                    setNotice('已添加 ZIP 模板，正在打开并生成封面…');
                  }
                  setBusy(false);
                })();
              }}
            />
            <button
              type="button"
              className="run-button"
              disabled={busy}
              onClick={() => zipTemplateInputRef.current?.click()}
            >
              <Upload size={16} /> 上传模板
            </button>
            <button
              type="button"
              className="soft-button landing-gallery-delete-template"
              disabled={busy || !selectedCustom}
              title={selectedCustom ? '删除当前选中的自定义模板' : '请先在下方图册中选中一个自定义模板（ZIP 或链接）'}
              onClick={() => void onDeleteCurrentCustomTemplate()}
            >
              <Trash2 size={16} /> 删除模板
            </button>
          </div>
        </div>

        <div className="landing-gallery-link-panel">
          <p className="landing-gallery-link-intro">添加方式二选一：上传 ZIP 包，或填写链接后按该网页样式在预览中复刻（iframe）。</p>
          <div className="landing-gallery-link-row">
            <input placeholder="模板名称" value={urlTplName} onChange={(e) => setUrlTplName(e.target.value)} />
            <input className="landing-gallery-link-url" placeholder="https://example.com/..." value={urlTplUrl} onChange={(e) => setUrlTplUrl(e.target.value)} />
            <button
              type="button"
              className="run-button"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  if (!authToken) {
                    return;
                  }
                  setBusy(true);
                  setNotice('');
                  const r = await landingAddTemplateUrl(runtimeBaseUrl, authToken, urlTplName.trim() || '外链模板', urlTplUrl.trim());
                  if (!r.success || !r.data?.doc) {
                    setNotice(r.error ?? '添加链接失败');
                  } else {
                    setDoc(r.data.doc);
                    setUrlTplUrl('');
                    setNotice('已按链接添加模板，预览将复刻该页样式');
                  }
                  setBusy(false);
                })();
              }}
            >
              添加链接模板
            </button>
          </div>
          <p className="muted-copy landing-gallery-scroll-hint">下方模板卡片区域可<strong>左右滑动</strong>查看更多；首次选中自定义模板会自动截取首页作为封面。</p>
        </div>

        <div className="landing-gallery-scroll" role="region" aria-label="模板列表，可横向滚动">
          <div className="landing-gallery-strip">
            {LANDING_GALLERY.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`landing-gallery-card ${doc.runtime.currentTemplateId === item.id ? 'landing-gallery-card--active' : ''}`}
                onClick={() => {
                  setDoc({ ...doc, runtime: { ...doc.runtime, currentTemplateId: item.id } });
                  void saveProfile({ currentTemplateId: item.id });
                }}
              >
                <div className="landing-gallery-thumb" style={{ background: item.thumb }} />
                <strong>{item.name}</strong>
                <small>{item.accent}</small>
              </button>
            ))}
            {customList.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`landing-gallery-card landing-gallery-card--custom ${doc.runtime.currentTemplateId === item.id ? 'landing-gallery-card--active' : ''}`}
                onClick={() => {
                  setDoc({ ...doc, runtime: { ...doc.runtime, currentTemplateId: item.id } });
                  void saveProfile({ currentTemplateId: item.id });
                }}
              >
                <div
                  className="landing-gallery-thumb"
                  style={
                    item.coverCaptured && authToken
                      ? {
                          backgroundImage: `url("${joinRuntime(runtimeBaseUrl, `/landing/templates/${item.id}/cover.png`)}?access_token=${encodeURIComponent(authToken)}")`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'top center',
                        }
                      : { background: 'linear-gradient(135deg,#0f172a,#475569)' }
                  }
                />
                <strong>{item.name}</strong>
                <small>{item.source === 'url' ? '链接复刻' : 'ZIP'}</small>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
