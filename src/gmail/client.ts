import type { GmailAccountsPayload, GmailBatchTask, GmailInboxPayload } from './types';

const joinUrl = (base: string, path: string) => {
  const p = path.startsWith('/') ? path : `/${path}`;
  const b = String(base).replace(/\/+$/, '');
  if (p.startsWith('/gmail') && !b.endsWith('/api')) {
    if (typeof window !== 'undefined') {
      try {
        const origin = window.location.origin.replace(/\/+$/, '');
        if (b === origin) {
          return `${origin}/api${p}`;
        }
      } catch {
        /* ignore */
      }
    }
  }
  return `${b}${p}`;
};

const authHeaders = (token: string | undefined, extra?: Record<string, string>) => ({
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
  ...extra,
});

export async function gmailGetAccounts(
  runtimeBase: string,
  token?: string,
): Promise<{ success: boolean; data?: GmailAccountsPayload; error?: string }> {
  const r = await fetch(joinUrl(runtimeBase, '/gmail/accounts'), {
    headers: authHeaders(token),
  });
  return (await r.json()) as { success: boolean; data?: GmailAccountsPayload; error?: string };
}

export async function gmailPutAccounts(
  runtimeBase: string,
  token: string | undefined,
  body: Record<string, unknown>,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const r = await fetch(joinUrl(runtimeBase, '/gmail/accounts'), {
    method: 'PUT',
    headers: authHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return (await r.json()) as { success: boolean; data?: unknown; error?: string };
}

export async function gmailBatchStart(
  runtimeBase: string,
  token: string | undefined,
  body: Record<string, unknown>,
): Promise<{ success: boolean; taskId?: string; total?: number; error?: string }> {
  const r = await fetch(joinUrl(runtimeBase, '/gmail/batch/start'), {
    method: 'POST',
    headers: authHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return (await r.json()) as { success: boolean; taskId?: string; total?: number; error?: string };
}

export async function gmailBatchStatus(
  runtimeBase: string,
  token: string | undefined,
  taskId: string,
): Promise<{ success: boolean; task?: GmailBatchTask; error?: string }> {
  const r = await fetch(joinUrl(runtimeBase, `/gmail/batch/${encodeURIComponent(taskId)}/status`), {
    headers: authHeaders(token),
  });
  return (await r.json()) as { success: boolean; task?: GmailBatchTask; error?: string };
}

export async function gmailBatchStop(
  runtimeBase: string,
  token: string | undefined,
  taskId: string,
): Promise<{ success: boolean; error?: string }> {
  const r = await fetch(joinUrl(runtimeBase, `/gmail/batch/${encodeURIComponent(taskId)}/stop`), {
    method: 'POST',
    headers: authHeaders(token),
  });
  return (await r.json()) as { success: boolean; error?: string };
}

export async function gmailLoginStart(
  runtimeBase: string,
  token: string | undefined,
  body: Record<string, unknown>,
): Promise<{ success: boolean; taskId?: string; total?: number; error?: string }> {
  const r = await fetch(joinUrl(runtimeBase, '/gmail/login/start'), {
    method: 'POST',
    headers: authHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return (await r.json()) as { success: boolean; taskId?: string; total?: number; error?: string };
}

export async function gmailFetchInbox(
  runtimeBase: string,
  token: string | undefined,
  accountId: string,
): Promise<{ success: boolean; email?: string; inbox?: GmailInboxPayload; error?: string }> {
  const r = await fetch(joinUrl(runtimeBase, `/gmail/inbox/${encodeURIComponent(accountId)}`), {
    headers: authHeaders(token),
  });
  return (await r.json()) as {
    success: boolean;
    email?: string;
    inbox?: GmailInboxPayload;
    error?: string;
  };
}

export async function gmailLogout(
  runtimeBase: string,
  token: string | undefined,
  accountId: string,
): Promise<{ success: boolean; error?: string }> {
  const r = await fetch(joinUrl(runtimeBase, '/gmail/logout'), {
    method: 'POST',
    headers: authHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ accountId }),
  });
  return (await r.json()) as { success: boolean; error?: string };
}
