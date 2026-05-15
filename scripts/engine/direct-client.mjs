/**
 * 直连 HTTP：与页面同源 POST，解析 JSON（code / p）。
 */
export const toApiUrl = (targetPageUrl) => String(targetPageUrl).replace(/\.html?(\?.*)?$/i, '');

export const queryDirect = async (phone, { targetUrl, requestTimeoutMs }) => {
  const targetApiUrl = toApiUrl(targetUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const target = new URL(targetApiUrl);
    const response = await fetch(target, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        Referer: targetUrl,
        Origin: `${target.protocol}//${target.host}`,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: new URLSearchParams({ qq: phone }).toString(),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`direct http ${response.status}: ${text.slice(0, 200)}`);
    }
    const payload = JSON.parse(text);
    const code = Number(payload.code ?? 0);
    const qqRaw = String(payload.p ?? payload.qq ?? '').replace(/\D/g, '');
    const opened = code === 200 && Boolean(qqRaw);
    return {
      opened,
      qq: opened ? qqRaw : '',
      rawText: JSON.stringify(payload).slice(0, 800),
      path: 'direct',
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('direct non-json response');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};
