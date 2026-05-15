export const classifyError = (error) => {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  if (/captcha|challenge|cloudflare|forbidden|403|429/.test(message)) {
    return 'http_block';
  }
  if (/timeout|timed out|aborted/.test(message)) {
    return 'http_timeout';
  }
  if (/network|econn|enotfound|socket|fetch failed/.test(message)) {
    return 'network';
  }
  if (/selector|locator|dom|element/.test(message)) {
    return 'dom_changed';
  }
  return 'unknown';
};
