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
html{height:100%;scroll-behavior:smooth;}
*{box-sizing:border-box;}
body{margin:0;min-height:100%;overflow-x:hidden;overflow-y:auto;-webkit-overflow-scrolling:touch;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,"PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--fg);}
a{color:inherit;}
.lp-wrap{max-width:1080px;margin:0 auto;padding:0 clamp(16px,4vw,28px);}
.lp-band{padding:clamp(26px,5vw,52px) 0;}
.lp-h2{margin:0 0 10px;font-size:clamp(1.12rem,2.4vw,1.42rem);letter-spacing:-0.02em;color:color-mix(in srgb,var(--fg) 92%,var(--a));}
.lp-p{margin:0;color:var(--muted);line-height:1.68;font-size:0.98rem;}
.lp-grid2{display:grid;gap:14px;grid-template-columns:repeat(2,minmax(0,1fr));}
.lp-grid3{display:grid;gap:14px;grid-template-columns:repeat(3,minmax(0,1fr));}
@media(max-width:720px){.lp-grid2,.lp-grid3{grid-template-columns:1fr;}}
.lp-card{border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:16px 16px 14px;background:rgba(255,255,255,.045);}
.lp-kpi{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;text-align:center;}
.lp-kpi b{display:block;font-size:clamp(1.2rem,3vw,1.55rem);color:var(--fg);font-weight:900;}
.lp-kpi span{display:block;margin-top:4px;font-size:0.78rem;color:var(--muted);}
.lp-quote{margin:0;padding:16px 18px;border-left:4px solid var(--a);background:rgba(255,255,255,.04);border-radius:0 14px 14px 0;font-size:0.95rem;color:var(--muted);line-height:1.65;}
.lp-faq dt{margin:12px 0 4px;font-weight:900;color:var(--fg);font-size:0.92rem;}
.lp-faq dd{margin:0 0 8px;color:var(--muted);font-size:0.88rem;line-height:1.55;}
.lp-cta{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 26px;border-radius:14px;font-weight:800;text-decoration:none;color:#041016;background:linear-gradient(135deg,color-mix(in srgb,var(--a) 88%,#fff),var(--a));box-shadow:0 18px 40px color-mix(in srgb,var(--a) 32%,transparent);}
.lp-muted{color:var(--muted);line-height:1.55;}
.lp-logo{max-width:160px;max-height:56px;object-fit:contain;border-radius:12px;background:rgba(255,255,255,.06);padding:6px;}
.lp-deco{width:100%;height:auto;display:block;border-radius:16px;}
.lp-photo{width:100%;border-radius:16px;display:block;}
@media print{
  body{background:#fff;color:#111;}
  .lp-wrap{max-width:100%;}
  .lp-band{break-inside:avoid;page-break-inside:avoid;}
  .lp-card,.lp-kpi{break-inside:avoid;}
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

const industryBlurb = (profile: LandingProfile, rnd: () => number): string => {
  const t = profile.companyType.trim();
  if (/科技|互联网|软件|IT|芯片|云/i.test(t)) {
    return '以数据与工程化能力，把触达、转化与复盘串成闭环：可量化、可扩容、可审计，让增长团队始终对齐同一套事实。';
  }
  if (/金融|银行|支付|信贷|投/i.test(t)) {
    return '在合规边界内做增长：稳定的链路、权限隔离与清晰留痕，让业务推进既快又稳。';
  }
  if (/教育|培训|学校/i.test(t)) {
    return '把复杂流程讲清楚：渠道、线索与转化路径一目了然，帮助招生与运营同事用同一套叙事对外沟通。';
  }
  if (/医疗|健康|诊所|药/i.test(t)) {
    return '用克制而专业的信息架构呈现服务边界与优势，让访客在第一眼建立信任，并知道下一步该如何联系您。';
  }
  if (/制造|供应链|物流|跨境/i.test(t)) {
    return '把交付能力、配套资源与客户价值讲清楚：节奏可视化、能力可核验，让合作决策更快落地。';
  }
  return pick(
    [
      '以扎实产品与透明协作，让客户在每一个触点都感受到专业效率。',
      '把复杂留给自己，把清晰留给访客：这是我们对品牌落地页一贯的标准。',
      '可持续的增长来自系统化能力——我们帮助您把优势讲清楚、把路径讲明白。',
    ],
    rnd,
  );
};

const goalLineForButton = (profile: LandingProfile, rnd: () => number): string => {
  if (profile.buttonType === 'app') {
    return pick(
      [
        '一键直达应用商店或安装包，缩短从「感兴趣」到「打开 App」的路径。',
        '把下载理由写在前排：版本亮点、适配说明与隐私承诺，让用户安心安装。',
      ],
      rnd,
    );
  }
  if (profile.buttonType === 'service') {
    return pick(
      [
        '把咨询入口放在视觉焦点：WhatsApp / 企微 / 热线任选其一，减少犹豫与跳失。',
        '用清晰的服务时段与响应承诺，降低客户发起对话的心理成本。',
      ],
      rnd,
    );
  }
  return pick(
    [
      '把官网当作「信任中枢」：用结构化信息承接广告与私域流量，让访客快速完成下一步。',
      '用一条主路径讲清：你是谁、解决什么问题、为什么现在就该行动。',
    ],
    rnd,
  );
};

const layoutPremiumScroll = (profile: LandingProfile, rnd: () => number, accent: string, logoHtml: string, deco: string) => {
  const brand = profile.projectName.trim() || '您的品牌';
  const ctype = profile.companyType.trim() || '成长型企业';
  const blurb = industryBlurb(profile, rnd);
  const goal = goalLineForButton(profile, rnd);
  const k1 = 12 + Math.floor(rnd() * 38);
  const k2 = 86 + Math.floor(rnd() * 12);
  const k3 = 3 + Math.floor(rnd() * 8);
  const f1 = pick(['全链路可视化', '多角色权限隔离', '分钟级弹性扩容', '命中结果可追溯'], rnd);
  const f2 = pick(['智能端口与队列', '异常自愈与告警', '导出与对账一体化', '审计日志可检索'], rnd);
  const f3 = pick(['低门槛上手', '高并发仍稳定', '私有化可部署', '对接方式标准化'], rnd);
  const f4 = pick(['策略模板可复用', 'A/B 快速试验', '渠道归因更清晰', '复盘报告一键生成'], rnd);
  const q1 = pick(['你们适合什么规模的团队？', '落地页能否与现有 CRM 对接？', '是否支持私有化部署？', '交付周期大概多久？'], rnd);
  const a1 = pick(
    [
      '从十几人到上千人团队都有成熟实践；我们会按你的并发、合规与集成诉求给出架构建议。',
      '通常 1–3 周可完成首版联调上线，复杂集成按里程碑拆分，风险可控。',
    ],
    rnd,
  );
  const q2 = pick(['数据安全如何保证？', '是否支持多语言？', '能否做品牌视觉定制？'], rnd);
  const a2 = pick(
    [
      '支持字段级权限、操作留痕与导出审计；关键链路可加密与脱敏展示。',
      '支持多语言与多套主题；也可按品牌规范输出组件级样式。',
    ],
    rnd,
  );
  return wrapDoc(
    brand,
    `<main>
  <section class="lp-band" style="padding-top:clamp(24px,6vw,48px);background:radial-gradient(1200px 500px at 10% -10%,color-mix(in srgb,var(--a) 22%,transparent),transparent);">
    <div class="lp-wrap" style="display:grid;gap:18px;">
      ${logoHtml}
      <div style="display:grid;gap:10px;">
        <p class="lp-muted" style="margin:0;font-size:.82rem;letter-spacing:.12em;text-transform:uppercase;color:color-mix(in srgb,var(--a) 65%,#fff);">${esc(ctype)} · 品牌典藏版</p>
        <h1 style="margin:0;font-size:clamp(1.75rem,4.6vw,2.75rem);line-height:1.08;letter-spacing:-0.03em;">${esc(brand)}</h1>
        <p class="lp-p" style="max-width:820px;font-size:1.05rem;color:rgba(234,247,255,.86);">${esc(blurb)}</p>
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:4px;">
          <a class="lp-cta" href="${esc(ctaHrefFor(profile))}">${esc(ctaLabelFor(profile))}</a>
          <span class="lp-muted" style="align-self:center;font-size:.86rem;">${esc(goal)}</span>
        </div>
      </div>
      <div style="margin-top:8px;">${deco}</div>
    </div>
  </section>
  <section class="lp-band" style="background:rgba(255,255,255,.03);">
    <div class="lp-wrap">
      <h2 class="lp-h2">关键指标（示意）</h2>
      <p class="lp-p" style="margin:0 0 16px;max-width:720px;">以下数字用于版式演示，您可在正式投放时替换为真实业务数据。</p>
      <div class="lp-kpi">
        <div class="lp-card"><b>${k1}ms</b><span>典型响应</span></div>
        <div class="lp-card"><b>${k2}%</b><span>链路可用性</span></div>
        <div class="lp-card"><b>${k3}×</b><span>峰值弹性</span></div>
      </div>
    </div>
  </section>
  <section class="lp-band">
    <div class="lp-wrap">
      <h2 class="lp-h2">为「${esc(ctype)}」量身编排的信息结构</h2>
      <p class="lp-p" style="margin:0 0 18px;max-width:860px;">围绕您的品牌名、行业类型与转化目标（${esc(
        profile.buttonType === 'app' ? 'App 下载' : profile.buttonType === 'service' ? '客服咨询' : '官网访问',
      )}），我们用分层叙事把卖点讲透：先建立信任，再给出证据，最后推动行动。</p>
      <div class="lp-grid2">
        <div class="lp-card"><strong style="color:var(--fg);font-size:0.95rem;">${esc(f1)}</strong><p class="lp-p" style="margin-top:8px;">把关键能力拆成可扫读的模块，让访客 10 秒内理解价值主张。</p></div>
        <div class="lp-card"><strong style="color:var(--fg);font-size:0.95rem;">${esc(f2)}</strong><p class="lp-p" style="margin-top:8px;">用一致的节奏与间距组织内容，避免「信息堆叠」带来的压迫感。</p></div>
        <div class="lp-card"><strong style="color:var(--fg);font-size:0.95rem;">${esc(f3)}</strong><p class="lp-p" style="margin-top:8px;">把复杂流程隐藏在清晰的 CTA 之后，降低首次访问的认知负担。</p></div>
        <div class="lp-card"><strong style="color:var(--fg);font-size:0.95rem;">${esc(f4)}</strong><p class="lp-p" style="margin-top:8px;">为后续 A/B 与渠道迭代预留结构空间，减少返工成本。</p></div>
      </div>
    </div>
  </section>
  <section class="lp-band" style="background:rgba(255,255,255,.03);">
    <div class="lp-wrap">
      <h2 class="lp-h2">客户原声（示例）</h2>
      <blockquote class="lp-quote">「从线索到复盘，我们终于用同一套页面把故事讲清楚了。」<span style="display:block;margin-top:10px;color:rgba(234,247,255,.55);font-size:0.82rem;">— ${esc(ctype)} 业务负责人</span></blockquote>
    </div>
  </section>
  <section class="lp-band">
    <div class="lp-wrap">
      <h2 class="lp-h2">常见问题</h2>
      <dl class="lp-faq">
        <dt>${esc(q1)}</dt>
        <dd>${esc(a1)}</dd>
        <dt>${esc(q2)}</dt>
        <dd>${esc(a2)}</dd>
      </dl>
    </div>
  </section>
  <section class="lp-band" style="padding-bottom:clamp(40px,8vh,80px);text-align:center;">
    <div class="lp-wrap" style="display:grid;gap:12px;justify-items:center;">
      <h2 class="lp-h2" style="text-align:center;">准备好推进下一步？</h2>
      <p class="lp-p" style="text-align:center;max-width:560px;">我们已根据您填写的「${esc(brand)}」与「${esc(ctype)}」生成该典藏版式；保存资料后导出即可用于投放与复盘。</p>
      <a class="lp-cta" href="${esc(ctaHrefFor(profile))}">${esc(ctaLabelFor(profile))}</a>
    </div>
  </section>
</main>`,
    accent,
  );
};

const layoutHeroSplit = (profile: LandingProfile, rnd: () => number, accent: string, logoHtml: string, deco: string) => {
  const h1 = profile.projectName || '未命名项目';
  const sub = pick(subhooks, rnd);
  const lead = `${profile.companyType ? `${profile.companyType} · ` : ''}${pick(headlines, rnd)}`;
  const b1 = pick(bullets, rnd);
  const b2 = pick(bullets, rnd);
  const narrative = industryBlurb(profile, rnd);
  const goal = goalLineForButton(profile, rnd);
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
  <section style="margin-top:8px;padding-top:26px;border-top:1px solid rgba(255,255,255,.1);">
    <p class="lp-muted" style="margin:0;font-size:.95rem;line-height:1.65;">${esc(narrative)}</p>
    <p class="lp-muted" style="margin:12px 0 0;font-size:.88rem;line-height:1.55;">${esc(goal)}</p>
  </section>
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
    <p class="lp-muted" style="margin:0 0 14px;font-size:0.9rem;line-height:1.55;">${esc(industryBlurb(profile, rnd))}</p>
    <ul style="margin:0 0 14px;padding-left:18px;color:var(--muted);font-size:0.88rem;line-height:1.5;">
      <li>${esc(pick(bullets, rnd))}</li><li>${esc(pick(bullets, rnd))}</li><li>${esc(pick(bullets, rnd))}</li>
    </ul>
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
    <p class="lp-muted" style="margin:0;font-size:0.88rem;line-height:1.55;max-width:46ch;">${esc(industryBlurb(profile, rnd))}</p>
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
  const frame = doc.runtime.historyStack[doc.runtime.historyIndex] ?? { styleId: 'premium-scroll', seed: 1 };
  const rnd = mulberry32(frame.seed);
  const accent = /^#[0-9a-fA-F]{6}$/i.test(String(accentHex ?? '').trim())
    ? String(accentHex).trim()
    : '#22d3ee';
  const logoHtml = logoDataUrl
    ? `<img class="lp-logo" alt="logo" src='${String(logoDataUrl).replace(/'/g, '&#39;')}'/>`
    : `<div class="lp-muted" style="font-size:.85rem;">未上传 Logo 时将使用抽象图形</div>`;
  const deco = placeholderImg(frame.seed, doc.settings.usePlaceholderImages);
  const sid = frame.styleId;
  if (sid === 'premium-scroll') {
    return layoutPremiumScroll(doc.profile, rnd, accent, logoHtml, deco);
  }
  if (sid === 'card-stack') {
    return layoutCardStack(doc.profile, rnd, accent, logoHtml, deco);
  }
  if (sid === 'minimal-center') {
    return layoutMinimalCenter(doc.profile, rnd, accent, logoHtml);
  }
  return layoutHeroSplit(doc.profile, rnd, accent, logoHtml, deco);
}
