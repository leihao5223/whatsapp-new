type LoginResponse = {
  success: boolean;
  account?: string;
  workerId?: string;
  message?: string;
  error?: string;
};

type VercelRequest = {
  method?: string;
  body?: unknown;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: LoginResponse) => void;
  setHeader: (name: string, value: string) => void;
};

const runnerEndpoint = process.env.QQ_RUNNER_ENDPOINT;

const runnerLoginEndpoint = () => {
  if (!runnerEndpoint) {
    return undefined;
  }

  const url = new URL(runnerEndpoint);
  url.pathname = url.pathname.replace(/\/search\/?$/, '/login');
  if (!url.pathname.endsWith('/login')) {
    url.pathname = `${url.pathname.replace(/\/$/, '')}/login`;
  }
  return url.toString();
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  const body = typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {};
  const portId = typeof body.portId === 'string' ? body.portId.trim() : '';
  const account = typeof body.account === 'string' ? body.account.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!portId || !account || !password) {
    res.status(400).json({ success: false, error: 'Missing portId, account, or password' });
    return;
  }

  const endpoint = runnerLoginEndpoint();
  if (!endpoint) {
    res.status(501).json({
      success: false,
      error: 'QQ_RUNNER_ENDPOINT is not configured. The system cannot perform autonomous QQ login yet.',
    });
    return;
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ portId, account, password }),
    });

    const data = (await response.json()) as LoginResponse;
    res.status(response.ok ? 200 : response.status).json(data);
  } catch (error) {
    res.status(502).json({
      success: false,
      error: error instanceof Error ? error.message : 'QQ runner login request failed',
    });
  }
}
