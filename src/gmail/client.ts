import type { GmailAccountRow, GmailAccountsPayload, GmailBatchTask, GmailInboxPayload, GmailLoginResult } from './types';

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

async function parseJson<T>(r: Response): Promise<T & { success: boolean; error?: string }> {
  try {
    const payload = (await r.json()) as T & { success: boolean; error?: string };
    if (!r.ok && !payload.error) {
      payload.success = false;
      (payload as { error?: string }).error = `请求失败 HTTP ${r.status}`;
    }
    return payload;
  } catch {
    return { success: false, error: `请求失败 HTTP ${r.status}` } as T & { success: boolean; error?: string };
  }
}

export async function gmailGetAccounts(runtimeBase: string, token?: string) {
  const r = await fetch(joinUrl(runtimeBase, '/gmail/accounts'), { headers: authHeaders(token) });
  return parseJson<{ data?: GmailAccountsPayload }>(r);
}

export async function gmailAddPort(runtimeBase: string, token?: string) {
  const r = await fetch(joinUrl(runtimeBase, '/gmail/accounts/add'), {
    method: 'POST',
    headers: authHeaders(token),
  });
  return parseJson<{ account?: GmailAccountRow }>(r);
}

export async function gmailPatchAccount(
  runtimeBase: string,
  token: string | undefined,
  accountId: string,
  body: { email?: string; password?: string; note?: string },
) {
  const r = await fetch(joinUrl(runtimeBase, `/gmail/accounts/${encodeURIComponent(accountId)}`), {
    method: 'PATCH',
    headers: authHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return parseJson<{ account?: GmailAccountRow }>(r);
}

export async function gmailDeleteAccount(runtimeBase: string, token: string | undefined, accountId: string) {
  const r = await fetch(joinUrl(runtimeBase, `/gmail/accounts/${encodeURIComponent(accountId)}`), {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  return parseJson<Record<string, never>>(r);
}

export async function gmailLoginAccount(
  runtimeBase: string,
  token: string | undefined,
  accountId: string,
  body: { email: string; password: string },
): Promise<GmailLoginResult> {
  const r = await fetch(joinUrl(runtimeBase, `/gmail/accounts/${encodeURIComponent(accountId)}/login`), {
    method: 'POST',
    headers: authHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return parseJson<GmailLoginResult>(r);
}

export async function gmailLoginStatus(runtimeBase: string, token: string | undefined, accountId: string) {
  const r = await fetch(joinUrl(runtimeBase, `/gmail/accounts/${encodeURIComponent(accountId)}/login-status`), {
    headers: authHeaders(token),
  });
  return parseJson<GmailLoginResult>(r);
}

export async function gmailVerifyAccount(
  runtimeBase: string,
  token: string | undefined,
  accountId: string,
  body: { code?: string; approved?: boolean },
) {
  const r = await fetch(joinUrl(runtimeBase, `/gmail/accounts/${encodeURIComponent(accountId)}/verify`), {
    method: 'POST',
    headers: authHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return parseJson<GmailLoginResult>(r);
}

export async function gmailCheckNewMail(runtimeBase: string, token?: string) {
  const r = await fetch(joinUrl(runtimeBase, '/gmail/accounts/check-new-mail'), { headers: authHeaders(token) });
  return parseJson<{ accounts?: Array<{ id: string; hasNewMail: boolean; unread: number }> }>(r);
}

export async function gmailFetchInbox(runtimeBase: string, token: string | undefined, accountId: string) {
  const r = await fetch(joinUrl(runtimeBase, `/gmail/inbox/${encodeURIComponent(accountId)}`), {
    headers: authHeaders(token),
  });
  return parseJson<{ email?: string; inbox?: GmailInboxPayload }>(r);
}

export async function gmailLogout(runtimeBase: string, token: string | undefined, accountId: string) {
  const r = await fetch(joinUrl(runtimeBase, '/gmail/logout'), {
    method: 'POST',
    headers: authHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ accountId }),
  });
  return parseJson<Record<string, never>>(r);
}

export async function gmailPutAccounts(
  runtimeBase: string,
  token: string | undefined,
  body: Record<string, unknown>,
) {
  const r = await fetch(joinUrl(runtimeBase, '/gmail/accounts'), {
    method: 'PUT',
    headers: authHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return parseJson<{ data?: unknown; autoLoginTaskId?: string }>(r);
}

export async function gmailBatchStart(runtimeBase: string, token: string | undefined, body: Record<string, unknown>) {
  const r = await fetch(joinUrl(runtimeBase, '/gmail/batch/start'), {
    method: 'POST',
    headers: authHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return parseJson<{ taskId?: string; total?: number }>(r);
}

export async function gmailBatchStatus(runtimeBase: string, token: string | undefined, taskId: string) {
  const r = await fetch(joinUrl(runtimeBase, `/gmail/batch/${encodeURIComponent(taskId)}/status`), {
    headers: authHeaders(token),
  });
  return parseJson<{ task?: GmailBatchTask }>(r);
}

export async function gmailBatchStop(runtimeBase: string, token: string | undefined, taskId: string) {
  const r = await fetch(joinUrl(runtimeBase, `/gmail/batch/${encodeURIComponent(taskId)}/stop`), {
    method: 'POST',
    headers: authHeaders(token),
  });
  return parseJson<Record<string, never>>(r);
}
