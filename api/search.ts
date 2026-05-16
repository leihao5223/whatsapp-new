type SearchCategory = '高价值' | '待复核' | '无效线索';

type SearchResponse = {
  success: boolean;
  title?: string;
  category?: SearchCategory;
  summary?: string;
  score?: number;
  source?: string;
  tags?: string[];
  error?: string;
};

type VercelRequest = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: SearchResponse) => void;
  setHeader: (name: string, value: string) => void;
};

type ProviderPayload = {
  success?: boolean;
  title?: string;
  category?: string;
  summary?: string;
  score?: number;
  confidence?: number;
  source?: string;
  tags?: string[];
  results?: Array<{
    title?: string;
    summary?: string;
    snippet?: string;
    score?: number;
    tags?: string[];
  }>;
};

const configuredEndpoint = process.env.QQ_SEARCH_ENDPOINT;
const localRunnerEndpoint = process.env.QQ_RUNNER_ENDPOINT;
const configuredMethod = (process.env.QQ_SEARCH_METHOD ?? 'POST').toUpperCase();
const queryParam = process.env.QQ_SEARCH_QUERY_PARAM ?? 'q';
const responseMode = (process.env.QQ_SEARCH_RESPONSE_MODE ?? 'json').toLowerCase();

const normalizeCategory = (category?: string, score = 72): SearchCategory => {
  if (category === '高价值' || category === '待复核' || category === '无效线索') {
    return category;
  }

  if (score >= 86) {
    return '高价值';
  }

  if (score >= 60) {
    return '待复核';
  }

  return '无效线索';
};

const extractQuery = (req: VercelRequest) => {
  if (typeof req.body === 'object' && req.body !== null && 'query' in req.body) {
    const value = (req.body as { query?: unknown }).query;
    return typeof value === 'string' ? value.trim() : '';
  }

  const queryValue = req.query?.query ?? req.query?.q;
  if (Array.isArray(queryValue)) {
    return queryValue[0]?.trim() ?? '';
  }

  return queryValue?.trim() ?? '';
};

const providerHeaders = () => {
  const headers: Record<string, string> = {
    Accept: responseMode === 'html' ? 'text/html,application/xhtml+xml' : 'application/json',
  };

  if (configuredMethod !== 'GET') {
    headers['Content-Type'] = 'application/json';
  }

  if (process.env.QQ_SEARCH_API_KEY) {
    headers.Authorization = `Bearer ${process.env.QQ_SEARCH_API_KEY}`;
  }

  if (process.env.QQ_SEARCH_COOKIE) {
    headers.Cookie = process.env.QQ_SEARCH_COOKIE;
  }

  return headers;
};

const providerUrl = (query: string) => {
  if (!configuredEndpoint) {
    throw new Error('QQ_SEARCH_ENDPOINT is not configured');
  }

  const url = new URL(configuredEndpoint);
  if (configuredMethod === 'GET') {
    url.searchParams.set(queryParam, query);
  }

  return url.toString();
};

const parseJsonProviderResponse = async (response: Response, query: string): Promise<SearchResponse> => {
  const data = (await response.json()) as ProviderPayload;

  if (data.success === false) {
    return { success: false };
  }

  const firstResult = data.results?.[0];
  const score = Math.max(0, Math.min(100, Math.round(data.confidence ?? data.score ?? firstResult?.score ?? 72)));

  return {
    success: true,
    title: data.title ?? firstResult?.title ?? `QQ 搜索返回 ${query.slice(0, 18)}`,
    category: normalizeCategory(data.category, score),
    summary: data.summary ?? firstResult?.summary ?? firstResult?.snippet ?? 'QQ 搜索服务已返回结果。',
    score,
    source: data.source ?? '真实QQ搜索框',
    tags: data.tags?.length ? data.tags : firstResult?.tags?.length ? firstResult.tags : ['QQ搜索', '真实接口'],
  };
};

const stripHtml = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const parseHtmlProviderResponse = async (response: Response, query: string): Promise<SearchResponse> => {
  const html = await response.text();
  const text = stripHtml(html);

  if (!text || /无结果|没有找到|not found|no result/i.test(text)) {
    return { success: false };
  }

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim();
  const score = text.includes(query) ? 82 : 68;

  return {
    success: true,
    title: title || `QQ 搜索返回 ${query.slice(0, 18)}`,
    category: normalizeCategory(undefined, score),
    summary: text.slice(0, 180),
    score,
    source: '真实QQ搜索框',
    tags: ['QQ搜索', 'HTML解析'],
  };
};

const forwardToLocalRunner = async (query: string): Promise<SearchResponse> => {
  if (!localRunnerEndpoint) {
    throw new Error('QQ_RUNNER_ENDPOINT is not configured');
  }

  const response = await fetch(localRunnerEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    return {
      success: false,
      error: `QQ local runner returned ${response.status}`,
    };
  }

  return (await response.json()) as SearchResponse;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  const query = extractQuery(req);
  if (!query) {
    res.status(400).json({ success: false, error: 'Missing query' });
    return;
  }

  if (localRunnerEndpoint) {
    try {
      res.status(200).json(await forwardToLocalRunner(query));
    } catch (error) {
      res.status(502).json({
        success: false,
        error: error instanceof Error ? error.message : 'QQ local runner request failed',
      });
    }
    return;
  }

  if (!configuredEndpoint) {
    res.status(501).json({
      success: false,
      error:
        'QQ_RUNNER_ENDPOINT or QQ_SEARCH_ENDPOINT is not configured. Add one in Vercel Environment Variables.',
    });
    return;
  }

  try {
    const upstreamResponse = await fetch(providerUrl(query), {
      method: configuredMethod,
      headers: providerHeaders(),
      body: configuredMethod === 'GET' ? undefined : JSON.stringify({ query }),
    });

    if (!upstreamResponse.ok) {
      res.status(upstreamResponse.status).json({
        success: false,
        error: `QQ search provider returned ${upstreamResponse.status}`,
      });
      return;
    }

    const payload =
      responseMode === 'html'
        ? await parseHtmlProviderResponse(upstreamResponse, query)
        : await parseJsonProviderResponse(upstreamResponse, query);

    res.status(200).json(payload);
  } catch (error) {
    res.status(502).json({
      success: false,
      error: error instanceof Error ? error.message : 'QQ search provider request failed',
    });
  }
}
