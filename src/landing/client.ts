import type { LandingDoc } from './types';

const joinUrl = (base: string, path: string) => `${String(base).replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;

export async function landingGetProfile(runtimeBase: string, token: string): Promise<{ success: boolean; data?: LandingDoc; error?: string }> {
  const r = await fetch(joinUrl(runtimeBase, '/landing/profile'), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await r.json()) as { success: boolean; data?: LandingDoc; error?: string };
}

export async function landingPutProfile(
  runtimeBase: string,
  token: string,
  body: Record<string, unknown>,
): Promise<{ success: boolean; data?: LandingDoc; error?: string }> {
  const r = await fetch(joinUrl(runtimeBase, '/landing/profile'), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await r.json()) as { success: boolean; data?: LandingDoc; error?: string };
}

export async function landingPutSettings(
  runtimeBase: string,
  token: string,
  body: Record<string, unknown>,
): Promise<{ success: boolean; data?: LandingDoc; error?: string }> {
  const r = await fetch(joinUrl(runtimeBase, '/landing/settings'), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await r.json()) as { success: boolean; data?: LandingDoc; error?: string };
}

export async function landingLayoutNext(runtimeBase: string, token: string) {
  const r = await fetch(joinUrl(runtimeBase, '/landing/layout/next'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await r.json()) as { success: boolean; data?: { doc: LandingDoc }; error?: string };
}

export async function landingLayoutPrev(runtimeBase: string, token: string) {
  const r = await fetch(joinUrl(runtimeBase, '/landing/layout/prev'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await r.json()) as { success: boolean; data?: { doc: LandingDoc }; error?: string };
}

export async function landingSendSimulate(runtimeBase: string, token: string, styleId?: string) {
  const r = await fetch(joinUrl(runtimeBase, '/landing/send/simulate'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(styleId ? { styleId } : {}),
  });
  return (await r.json()) as { success: boolean; error?: string; styleId?: string; used?: number; limit?: number };
}

export async function landingSendNext(runtimeBase: string, token: string) {
  const r = await fetch(joinUrl(runtimeBase, '/landing/send/next'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await r.json()) as {
    success: boolean;
    error?: string;
    styleId?: string;
    virtualUrl?: string;
    remainingByStyle?: Record<string, number>;
    note?: string;
  };
}

export async function fetchLogoDataUrl(runtimeBase: string, token: string): Promise<string | null> {
  const r = await fetch(joinUrl(runtimeBase, '/landing/assets/logo'), { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    return null;
  }
  const blob = await r.blob();
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null);
    fr.onerror = () => resolve(null);
    fr.readAsDataURL(blob);
  });
}

export async function landingUploadTemplateZip(runtimeBase: string, token: string, file: File, name: string) {
  const fd = new FormData();
  fd.append('name', name || file.name.replace(/\.zip$/i, '') || 'ZIP 模板');
  fd.append('file', file);
  const r = await fetch(joinUrl(runtimeBase, '/landing/templates/from-zip'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  return (await r.json()) as { success: boolean; data?: { doc: LandingDoc; templateId?: string }; error?: string };
}

export async function landingAddTemplateUrl(runtimeBase: string, token: string, name: string, url: string) {
  const r = await fetch(joinUrl(runtimeBase, '/landing/templates/from-url'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, url }),
  });
  return (await r.json()) as { success: boolean; data?: { doc: LandingDoc; templateId?: string }; error?: string };
}

export async function landingCaptureTemplate(runtimeBase: string, token: string, templateId: string) {
  const r = await fetch(joinUrl(runtimeBase, `/landing/templates/${encodeURIComponent(templateId)}/capture`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await r.json()) as { success: boolean; data?: { doc: LandingDoc; skipped?: boolean }; error?: string };
}

export async function landingDeleteTemplate(runtimeBase: string, token: string, templateId: string) {
  const r = await fetch(joinUrl(runtimeBase, `/landing/templates/${encodeURIComponent(templateId)}`), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await r.json()) as { success: boolean; data?: { doc: LandingDoc }; error?: string };
}
