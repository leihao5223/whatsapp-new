/** 与后端 parseAccountLine 规则一致 */
export const parseAccountLine = (line: string) => {
  const trimmed = String(line ?? '').trim();
  if (!trimmed) {
    return null;
  }
  const delimParts = trimmed.split(/[\t,|]/).map((p) => p.trim());
  if (delimParts.length >= 2 && delimParts[0].includes('@')) {
    return {
      email: delimParts[0],
      password: delimParts[1],
      note: delimParts[2] ?? '',
    };
  }
  const spaceMatch = trimmed.match(/^(\S+@\S+)\s+(.+)$/);
  if (spaceMatch) {
    return {
      email: spaceMatch[1],
      password: spaceMatch[2].trim(),
      note: '',
    };
  }
  if (trimmed.includes('@')) {
    return { email: delimParts[0] || trimmed, password: '', note: '' };
  }
  return null;
};

export const parseAccountsFromText = (text: string) => {
  const rows: Array<{ email: string; password: string; note: string }> = [];
  for (const line of text.split(/\r?\n/)) {
    const p = parseAccountLine(line);
    if (p?.email.includes('@')) {
      rows.push(p);
    }
  }
  return rows;
};

export const validateAccountsText = (text: string): { ok: boolean; message: string } => {
  const rows = parseAccountsFromText(text);
  if (!rows.length) {
    return { ok: false, message: '请至少填写一行：邮箱与密码（可用 Tab、逗号或空格分隔）' };
  }
  const missingPwd = rows.filter((r) => !r.password);
  if (missingPwd.length) {
    return {
      ok: false,
      message: `以下账号缺少密码：${missingPwd.map((r) => r.email).join('、')}`,
    };
  }
  return { ok: true, message: '' };
};
