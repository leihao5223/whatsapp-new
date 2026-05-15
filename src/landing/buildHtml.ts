import type { LandingDoc, LandingProfile } from './types';

const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const esc = (s: string) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const pick = <T,>(arr: T[], rnd: () => number) => arr[Math.floor(rnd() * arr.length)] ?? arr[0];

const headlines = ['高效触达', '智能筛选', '稳定可靠', '数据驱动', '专业服务', '一站搞定'];
const subhooks = ['为业务增长加速', '让每一次触达更有价值', '合规、安全、可审计', '低配环境也能流畅跑', '团队协同更清晰', '结果可追溯'];
const bullets = ['实时状态回传', '多端口智能分配', '命中结果一键导出', '子账号权限隔离', 'IP 池灵活绑定'];

const ctaLabelFor = (profile: LandingProfile): string => {
  if (profile.buttonType === 'app') {
    return '立即下载 APP';
  }
  if (profile.buttonType === 'service') {
    return '联系客服';
  }
  return '访问官网';
};

const ctaHrefFor = (profile: LandingProfile): string => {
  if (profile.buttonType === 'app') {
    return profile.appDownloadUrl || '#';
  }
  if (profile.buttonType === 'service') {
    return profile.serviceUrl || '#';
  }
  return profile.siteUrl || '#';
};

const randomBlockSvg = (rnd: () => number, accent: string) => {
  const w = 520;
  const h = 220;
  const g1 = Math.floor(rnd() * 40);
  const g2 = Math.floor(rnd() * 60);
  return `<svg class="lp-deco" xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#0b1220" stop-opacity="0.9"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <circle cx="${120 + g1}" cy="${60 + g2}" r="90" fill="${accent}" fill-opacity="0.12"/>
  <circle cx="${380 - g1}" cy="${140 - g2}" r="70" fill="#5dffb0" fill-opacity="0.08"/>
</svg>`;
};

const placeholderImg = (seed: number, useUrl: boolean) => {
  if (useUrl) {
    return `<img class="lp-photo" alt="" src="https://picsum.photos/seed/${seed % 1000}/640/360" loading="lazy"/>`;
  }
  return randomBlockSvg(mulberry32(seed + 7), '#22d3ee');
};

const baseCss = (accent: string) => `:root{--a:${accent};--bg:#070b12;--fg:#eaf7ff;--muted:rgba(227,246,255,.72);}
*{box-sizing:border-box;}body{margin:0;min-height:100vh;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,"PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--fg);}
a{color:inherit;}
.lp-cta{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 26px;border-radius:14px;font-weight:800;text-decoration:none;color:#041016;background:linear-gradient(135deg,color-mix(in srgb,var(--a) 88%,#fff),var(--a));box-shadow:0 18px 40px color-mix(in srgb,var(--a) 32%,transparent);}
.lp-muted{color:var(--muted);line-height:1.55;}
.lp-logo{max-width:160px;max-height:56px;object-fit:contain;border-radius:12px;background:rgba(255,255,255,.06);padding:6px;}
.lp-deco{width:100%;height:auto;display:block;border-radius:16px;}
.lp-photo{width:100%;border-radius:16px;display:block;}
@media print{
  body{background:#fff;color:#111;}
  .lp-cta{box-shadow:none;border:1px solid #ccc;color:#111;background:#f3f4f6;}
}`;

const wrapDoc = (title: string, inner: string, accent: string) => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<style>${baseCss(accent)}</style>
</head>
<body>
${inner}
</body>
</html>`;

const layoutHeroSplit = (profile: LandingProfile, rnd: () => number, accent: string, logoHtml: string, deco: string) => {
  const h1 = profile.projectName || '未命名项目';
  const sub = pick(subhooks, rnd);
  const lead = `${profile.companyType ? `${profile.companyType} · ` : ''}${pick(headlines, rnd)}`;
  const b1 = pick(bullets, rnd);
  const b2 = pick(bullets, rnd);
  return wrapDoc(
    h1,
    `<main style="max-width:980px;margin:0 auto;padding:clamp(20px,5vw,40px) 18px;display:grid;gap:22px;grid-template-columns:1fr;align-items:center;">
  ${logoHtml}
  <div style="display:grid;gap:18px;grid-template-columns:1.1fr 0.9fr;align-items:center;">
    <div>
      <p class="lp-muted" style="margin:0 0 8px;font-size:.85rem;letter-spacing:.08em;text-transform:uppercase;color:color-mix(in srgb,var(--a) 70%,#fff);">${esc(lead)}</p>
      <h1 style="margin:0 0 12px;font-size:clamp(1.6rem,4vw,2.4rem);line-height:1.12;">${esc(h1)}</h1>
      <p class="lp-muted" style="margin:0 0 16px;font-size:1.05rem;">${esc(sub)}</p>
      <ul style="margin:0 0 18px;padding-left:18px;color:var(--muted);font-size:.95rem;">
        <li>${esc(b1)}</li><li>${esc(b2)}</li>
      </ul>
      <a class="lp-cta" href="${esc(ctaHrefFor(profile))}">${esc(ctaLabelFor(profile))}</a>
    </div>
    <div>${deco}</div>
  </div>
</main>`,
    accent,
  );
};

const layoutCardStack = (profile: LandingProfile, rnd: () => number, accent: string, logoHtml: string, deco: string) => {
  const h1 = profile.projectName || '未命名项目';
  const cardTitle = pick(headlines, rnd);
  return wrapDoc(
    h1,
    `<main style="max-width:560px;margin:0 auto;padding:clamp(22px,6vw,44px) 18px;display:grid;gap:16px;">
  ${logoHtml}
  <section style="border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:18px;background:rgba(255,255,255,.04);">
    <h1 style="margin:0 0 8px;font-size:clamp(1.5rem,4.5vw,2.1rem);">${esc(h1)}</h1>
    <p class="lp-muted" style="margin:0 0 12px;">${esc(profile.companyType || '企业客户')} · ${esc(cardTitle)}</p>
    <p class="lp-muted" style="margin:0 0 14px;">${esc(pick(subhooks, rnd))}</p>
    <div style="margin-bottom:14px;">${deco}</div>
    <a class="lp-cta" href="${esc(ctaHrefFor(profile))}">${esc(ctaLabelFor(profile))}</a>
  </section>
</main>`,
    accent,
  );
};

const layoutMinimalCenter = (profile: LandingProfile, rnd: () => number, accent: string, logoHtml: string) => {
  const h1 = profile.projectName || '未命名项目';
  return wrapDoc(
    h1,
    `<main style="min-height:100vh;display:grid;place-items:center;padding:24px 16px;text-align:center;">
  <div style="max-width:520px;display:grid;gap:14px;justify-items:center;">
    ${logoHtml}
    <p class="lp-muted" style="margin:0;font-size:.9rem;">${esc(profile.companyType || '企业客户')}</p>
    <h1 style="margin:0;font-size:clamp(1.7rem,5vw,2.6rem);line-height:1.1;">${esc(h1)}</h1>
    <p class="lp-muted" style="margin:0;">${esc(pick(subhooks, rnd))}</p>
    <a class="lp-cta" href="${esc(ctaHrefFor(profile))}">${esc(ctaLabelFor(profile))}</a>
  </div>
</main>`,
    accent,
  );
};

export type BuildLandingHtmlInput = {
  doc: Pick<LandingDoc, 'profile' | 'settings' | 'runtime'>;
  logoDataUrl?: string | null;
  accentHex?: string;
};

export function buildLandingHtml({ doc, logoDataUrl, accentHex }: BuildLandingHtmlInput): string {
  const frame = doc.runtime.historyStack[doc.runtime.historyIndex] ?? { styleId: 'hero-split', seed: 1 };
  const rnd = mulberry32(frame.seed);
  const accent = /^#[0-9a-fA-F]{6}$/i.test(String(accentHex ?? '').trim())
    ? String(accentHex).trim()
    : '#22d3ee';
  const logoHtml = logoDataUrl
    ? `<img class="lp-logo" alt="logo" src='${String(logoDataUrl).replace(/'/g, '&#39;')}'/>`
    : `<div class="lp-muted" style="font-size:.85rem;">未上传 Logo 时将使用抽象图形</div>`;
  const deco = placeholderImg(frame.seed, doc.settings.usePlaceholderImages);
  const sid = frame.styleId;
  if (sid === 'card-stack') {
    return layoutCardStack(doc.profile, rnd, accent, logoHtml, deco);
  }
  if (sid === 'minimal-center') {
    return layoutMinimalCenter(doc.profile, rnd, accent, logoHtml);
  }
  return layoutHeroSplit(doc.profile, rnd, accent, logoHtml, deco);
}
