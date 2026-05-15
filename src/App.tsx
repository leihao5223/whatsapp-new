import {
  Activity,
  Bot,
  CheckCircle2,
  Copy,
  DatabaseZap,
  Download,
  FileText,
  Gauge,
  LayoutDashboard,
  Monitor,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { type ChangeEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import './styles.css';

type PageKey = 'dashboard' | 'data' | 'accounts' | 'ipPool' | 'runner' | 'security';
type QueryStatus = 'pending' | 'running' | 'matched' | 'empty' | 'failed';
type PortStatus = 'ready' | 'booting' | 'offline';
type AccountStatus = 'normal' | 'abnormal';
type UserRole = 'super_admin' | 'sub_user';

type QueryItem = {
  id: string;
  raw: string;
  normalized: string;
  status: QueryStatus;
  result?: SearchResult;
  error?: string;
};

type SearchResult = {
  title: string;
  category: '开通' | '未开通';
  source: string;
  confidence: number;
  opened?: boolean;
  qq?: string;
  email?: string;
  decision?: 'auto-pass' | 'review' | 'reject';
  topCandidates?: Candidate[];
  summary: string;
  tags: string[];
};

type Candidate = {
  qq?: string;
  name?: string;
  score?: number;
  source?: string;
};

type SearchStats = {
  total: number;
  matched: number;
  empty: number;
  failed: number;
  pending: number;
};

type BatchRow = {
  phone: string;
  qq: string;
  query_time: string;
  retry_count: number;
};

type BatchStatus = {
  id: string;
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  total: number;
  processed: number;
  hit: number;
  failed: number;
  error?: string;
  mode?: 'direct' | 'hybrid' | 'browser';
  httpConcurrencyPerWorker?: number;
  directCount?: number;
  fallbackCount?: number;
  records?: Array<{ phone: string; qq: string; opened: boolean; retry_count: number; error?: string }>;
  sample?: Array<{ phone: string; qq: string; opened: boolean; retry_count: number; error?: string }>;
};

type PortRuntimeRow = {
  portId: string;
  status: 'ready' | 'paused' | 'offline';
  paused: boolean;
  inflight: number;
  updatedAt?: string;
};

type IpReserveRow = {
  proxy: string;
  state: 'reserve' | 'in_use' | 'cooling' | 'blocked';
  ok: boolean;
  score: number;
  latency_ms?: number;
  failureCount?: number;
  successCount?: number;
};

type IpEntry = {
  value: string;
  status: 'unchecked' | 'checking' | 'ok' | 'failed';
  latencyMs?: number;
  checkedAt?: string;
  error?: string;
};

type DataDocument = {
  id: string;
  name: string;
  rows: string[];
  createdAt: string;
};

type PortProgress = {
  assigned: number;
  processed: number;
};

type PortOutput = {
  phone: string;
  text: string;
};

type ReportSummary = {
  totals: { batches: number; total: number; processed: number; hit: number; failed: number };
  byPort: Array<{ portId: string; assigned: number; inflight: number }>;
  byErrorType: Record<string, number>;
  recent: Array<{
    batchId: string;
    status: string;
    total: number;
    processed: number;
    hit: number;
    failed: number;
    directCount: number;
    fallbackCount: number;
    mode: string;
    workerCount: number;
    startedAt: string;
    finishedAt: string;
  }>;
};

type SystemStatus = {
  host: {
    platform: string;
    arch: string;
    uptimeSec: number;
    cpus: number;
    totalMemGb: number;
    freeMemGb: number;
  };
  process: {
    rssMb: number;
    heapUsedMb: number;
  };
  queues: {
    pending: number;
    inflight: number;
    completed: number;
  };
  recommendation: {
    recommendedPorts: number;
    recommendedHttpConcurrencyPerWorker: number;
    estimatedDailyCapacity: number;
    targetMet: boolean;
  };
};

type AuthUser = {
  userId: string;
  username: string;
  role: UserRole;
  status?: string;
  permissions?: string[];
  createdAt?: string;
  lastLoginAt?: string;
};

type AuthSession = {
  token: string;
  refreshToken: string;
  expiresAt: string;
  user: AuthUser;
};

type AuditLogRow = {
  at: string;
  type: string;
  username?: string;
  actor?: string;
  target?: string;
  status?: string;
  batchId?: string;
  reason?: string;
};

type NumberLibraryStats = {
  total: number;
  unsent: number;
};

type TaskListItem = {
  id: string;
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  total: number;
  processed: number;
  hit: number;
  failed: number;
  startedAt?: string;
  finishedAt?: string;
};

type BatchRecord = {
  phone: string;
  qq: string;
  opened: boolean;
  retry_count: number;
  error?: string;
  query_time?: string;
};

type PipelineStatus = {
  history: number;
  pending: number;
  inflight: number;
  completed: number;
  logs: Array<{ at: string; type: string; phone?: string; result?: string; batchId?: string }>;
};

type EmulatorPort = {
  id: string;
  name: string;
  port: number;
  status: PortStatus;
  accountStatus: AccountStatus;
  qqInstalled: boolean;
  account?: string;
  note?: string;
  boundIp?: string;
  source: 'base-download' | 'cloned';
};

const categoryTone: Record<SearchResult['category'], string> = {
  开通: 'success',
  未开通: 'muted',
};

const searchEndpoint = (import.meta.env.VITE_QE_SEARCH_ENDPOINT as string | undefined) || '/api/search';
const portLoginEndpoint = (import.meta.env.VITE_QE_PORT_LOGIN_ENDPOINT as string | undefined) || '/api/ports/login';
const batchAuthToken =
  (import.meta.env.VITE_QE_BATCH_TOKEN as string | undefined) || 'Qq1314520..0254131q';
const tgLink = 'https://t.me/zz522377';

const initialPorts: EmulatorPort[] = [
  {
    id: 'port-1',
    name: 'QQ端口 01',
    port: 8787,
    status: 'ready',
    accountStatus: 'abnormal',
    qqInstalled: true,
    account: '未登录',
    note: '',
    boundIp: '',
    source: 'base-download',
  },
];

const normalizeRuntimeBase = (value: string) => value.trim().replace(/\/+$/, '');
const desktopFallbackRuntimeBase = 'http://127.0.0.1:8787';

const readSavedRuntimeBase = () => {
  if (typeof window === 'undefined') {
    return '';
  }
  const isFileProtocol = window.location.protocol === 'file:';
  const runtimeBaseFromQuery = new URLSearchParams(window.location.search).get('runtimeBase');
  if (runtimeBaseFromQuery?.trim()) {
    return runtimeBaseFromQuery.trim();
  }
  const saved = window.localStorage.getItem('qe-runtime-base');
  if (saved && saved.trim()) {
    try {
      const savedUrl = new URL(saved);
      const isSavedLoopback =
        savedUrl.hostname === '127.0.0.1' || savedUrl.hostname === 'localhost';
      const isCurrentLoopback =
        window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
      if (isSavedLoopback && !isCurrentLoopback && !isFileProtocol) {
        return window.location.origin;
      }
    } catch {
      // keep backward compatibility for legacy non-url values
    }
    return saved;
  }
  return isFileProtocol ? desktopFallbackRuntimeBase : window.location.origin;
};

const readSavedSession = (): AuthSession | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem('qe-auth-session');
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed?.token || !parsed?.user?.username) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const runtimeEndpoint = (runtimeBase: string, path: 'health' | 'login' | 'search' | 'feedback') => {
  if (!runtimeBase) {
    return undefined;
  }

  return `${normalizeRuntimeBase(runtimeBase)}/${path}`;
};

const runtimeBatchUrl = (runtimeBase: string, path: string) => {
  if (!runtimeBase) {
    return path.startsWith('/') ? path : `/${path}`;
  }
  return `${normalizeRuntimeBase(runtimeBase)}${path.startsWith('/') ? path : `/${path}`}`;
};

/** 认证走 `/api/auth/...`，与常见 `location /api/` 反代一致，避免仅配了 /api 时 /auth 404 */
const authApiPath = (path: string) => `/api${path.startsWith('/') ? path : `/${path}`}`;

/** Human-readable login errors; backend often returns English JSON `error`. */
const mapLoginApiError = (error: string | undefined, status: number): string => {
  const trimmed = error?.trim();
  if (trimmed === 'Invalid credentials') {
    return '账号或密码不正确';
  }
  if (trimmed === 'Missing username or password') {
    return '请输入账号和密码';
  }
  if (trimmed === 'Account temporarily locked') {
    return '尝试次数过多，账户已暂时锁定，请稍后再试';
  }
  if (trimmed) {
    return trimmed;
  }
  if (status === 404) {
    return '未找到登录接口（HTTP 404）。请确认 Nginx 已将 /api/ 或 /auth 转发到 QQ Runner（默认使用 /api/auth/login）。';
  }
  if (status === 502 || status === 503) {
    return '网关连不上 QQ Runner（HTTP 502/503）。请在服务器执行：进程是否已启动（node scripts/local-qq-runner.mjs）、端口是否与 Nginx 里 proxy_pass 一致（默认 8787，可用 QQ_RUNNER_PORT 修改）。';
  }
  if (status === 504) {
    return '网关等待 Runner 超时（HTTP 504），请检查 Runner 是否卡死或机器负载过高。';
  }
  if (status >= 500) {
    return `服务器异常（HTTP ${status}），请稍后重试`;
  }
  if (status > 0) {
    return `登录失败（HTTP ${status}）`;
  }
  return '登录失败';
};

const batchAuthHeaders = (sessionToken?: string, extra?: Record<string, string>) => ({
  ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : { 'x-runner-token': batchAuthToken }),
  ...extra,
});

const socks5Pattern = /^socks5:\/\/(?:[^:@\s]+(?::[^@\s]*)?@)?[a-zA-Z0-9.-]+:\d{2,5}$/i;

const parseSocks5Input = (value: string) =>
  value
    .split(/\r?\n|,|\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

const parsePhoneLines = (value: string) =>
  String(value ?? '')
    .split(/\r?\n|,|\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

const navItems: Array<{ key: PageKey; label: string; desc: string; icon: ReactNode }> = [
  { key: 'dashboard', label: '控制台', desc: '运行总览', icon: <LayoutDashboard size={17} /> },
  { key: 'data', label: '号码库', desc: '总库与未发送', icon: <Search size={17} /> },
  { key: 'accounts', label: '端口管理', desc: '端口/IP绑定', icon: <Monitor size={17} /> },
  { key: 'ipPool', label: 'IP池', desc: '导入与绑定', icon: <DatabaseZap size={17} /> },
  { key: 'runner', label: '任务管理', desc: '并发分发', icon: <Bot size={17} /> },
  { key: 'security', label: '账号安全', desc: '子账号/审计', icon: <ShieldCheck size={17} /> },
];

const parseTxtRows = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({
      id: `${Date.now()}-${index}-${line}`,
      raw: line,
      normalized: line.replace(/\s+/g, ''),
      status: 'pending' as QueryStatus,
    }));

const normalizeCategory = (category?: string): SearchResult['category'] => {
  if (category === '开通' || category === '未开通') {
    return category;
  }

  return '未开通';
};

const pickQqFromText = (text: string, phone: string) => {
  const matches = text.match(/\b\d{5,12}\b/g) ?? [];
  return matches.find((value) => value !== phone);
};

const pickQqFromPayload = (
  phone: string,
  data: {
    qq?: string;
    account?: string;
    title?: string;
    summary?: string;
    tags?: string[];
    email?: string;
    topCandidates?: Candidate[];
  },
) => {
  const directQq = data.qq?.trim() || data.account?.trim();
  if (directQq && /^\d{5,12}$/.test(directQq) && directQq !== phone) {
    return directQq;
  }

  const textQq = pickQqFromText([data.title ?? '', data.summary ?? '', (data.tags ?? []).join(' ')].join(' '), phone);
  if (textQq) {
    return textQq;
  }

  return data.topCandidates?.find((candidate) => candidate.qq && candidate.qq !== phone)?.qq;
};

const loginPortAccount = async (
  port: EmulatorPort,
  account: string,
  password: string,
  runtimeBase: string,
  loginMode: 'password' | 'existing-session' = 'password',
) => {
  const response = await fetch(runtimeEndpoint(runtimeBase, 'login') ?? portLoginEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      account,
      bindOnly: loginMode === 'existing-session',
      loginMode,
      password,
      portId: port.id,
      portName: port.name,
      portNumber: port.port,
    }),
  });

  const data = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    account?: string;
    message?: string;
    error?: string;
  };

  if (!response.ok || data.success === false) {
    throw new Error(data.error ?? data.message ?? `端口登录失败：${response.status}`);
  }

  return {
    account: data.account ?? account,
    message: data.message ?? '托管 QQ Runtime 已完成自动登录校验。',
  };
};

const searchQuery = async (query: string, runtimeBase: string): Promise<SearchResult | null> => {
  const response = await fetch(runtimeEndpoint(runtimeBase, 'search') ?? searchEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    const fallbackMessage = `搜索接口异常：${response.status}`;
    try {
      const errorData = (await response.json()) as { error?: string; message?: string };
      throw new Error(errorData.error ?? errorData.message ?? fallbackMessage);
    } catch (error) {
      if (error instanceof Error && error.message !== fallbackMessage) {
        throw error;
      }

      throw new Error(fallbackMessage, { cause: error });
    }
  }

  const data = (await response.json()) as {
    success?: boolean;
    opened?: boolean;
    status?: string;
    qq?: string;
    account?: string;
    title?: string;
    category?: string;
    summary?: string;
    score?: number;
    confidence?: number;
    source?: string;
    tags?: string[];
    email?: string;
    decision?: 'auto-pass' | 'review' | 'reject';
    topCandidates?: Candidate[];
  };

  if (data.success === false) {
    return null;
  }

  const inferredCategory = normalizeCategory(data.category);
  const hasExplicitClosedState =
    data.opened === false || data.status === 'closed' || data.status === 'inactive' || inferredCategory === '未开通';
  const opened =
    typeof data.opened === 'boolean'
      ? data.opened
      : data.status === 'opened' || data.status === 'active'
        ? true
        : !hasExplicitClosedState;

  return {
    title: data.title ?? `${opened ? '已开通' : '未开通'}：${query.slice(0, 18)}`,
    category: opened ? '开通' : '未开通',
    source: data.source ?? 'QQ搜索框',
    confidence: Math.max(0, Math.min(100, Math.round(data.confidence ?? data.score ?? 72))),
    opened,
    qq: opened ? pickQqFromPayload(query, data) : undefined,
    email: opened ? data.email : undefined,
    decision: data.decision,
    topCandidates: data.topCandidates ?? [],
    summary: data.summary ?? (opened ? 'Bridge 已判定该号码为开通状态。' : 'Bridge 已判定该号码未开通。'),
    tags: data.tags?.length ? data.tags : ['QQ搜索', opened ? '开通' : '未开通'],
  };
};

const toCsv = (items: QueryItem[]) => {
  const headers = ['原始数据', '标准化数据', '状态', '开通状态', '置信度', '结果标题', '摘要', '标签'];
  const rows = items.map((item) => [
    item.raw,
    item.normalized,
    item.status,
    item.result?.category ?? '',
    item.result?.confidence ?? '',
    item.result?.title ?? '',
    item.result?.summary ?? item.error ?? '',
    item.result?.tags.join('|') ?? '',
  ]);

  return [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
};


function App() {
  const [authSession, setAuthSession] = useState<AuthSession | null>(readSavedSession);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [subAccounts, setSubAccounts] = useState<AuthUser[]>([]);
  const [auditRows, setAuditRows] = useState<AuditLogRow[]>([]);
  const [newSubUsername, setNewSubUsername] = useState('');
  const [newSubPassword, setNewSubPassword] = useState('');
  const [activePage, setActivePage] = useState<PageKey>('dashboard');
  const [items, setItems] = useState<QueryItem[]>([]);
  const [manualValue, setManualValue] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [ports, setPorts] = useState<EmulatorPort[]>(initialPorts);
  const [runtimeBaseUrl, setRuntimeBaseUrl] = useState(readSavedRuntimeBase);
  const [reviewSubmittingId, setReviewSubmittingId] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchId, setBatchId] = useState('');
  const [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null);
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [dataDocs, setDataDocs] = useState<DataDocument[]>([]);
  const [dedupeLibrary, setDedupeLibrary] = useState<string[]>([]);
  const [runnerInput, setRunnerInput] = useState('');
  const [numberLibraryStats, setNumberLibraryStats] = useState<NumberLibraryStats>({ total: 0, unsent: 0 });
  const [runnerDocId, setRunnerDocId] = useState('');
  const [selectedPortIds, setSelectedPortIds] = useState<string[]>([]);
  const [manualPortSelection, setManualPortSelection] = useState(false);
  const [portProgress, setPortProgress] = useState<Record<string, PortProgress>>({});
  const [batchPortOrder, setBatchPortOrder] = useState<string[]>([]);
  const [portOutputs, setPortOutputs] = useState<Record<string, PortOutput>>({});
  const [phonePortMap, setPhonePortMap] = useState<Record<string, string>>({});
  const [distributionPlan, setDistributionPlan] = useState<Record<string, number>>({});
  const [planSummary, setPlanSummary] = useState<{ raw: number; unique: number; unscreened: number } | null>(null);
  const [runnerNotice, setRunnerNotice] = useState('');
  const [selfCheckSummary, setSelfCheckSummary] = useState('');
  const [batchMode, setBatchMode] = useState<'direct' | 'hybrid' | 'browser'>('hybrid');
  const [httpConcurrencyPerWorker, setHttpConcurrencyPerWorker] = useState(8);
  const [portRuntimeRows, setPortRuntimeRows] = useState<PortRuntimeRow[]>([]);
  const [ipReserveRows, setIpReserveRows] = useState<IpReserveRow[]>([]);
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus>({
    history: 0,
    pending: 0,
    inflight: 0,
    completed: 0,
    logs: [],
  });
  const [reportSummary, setReportSummary] = useState<ReportSummary | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [ipInput, setIpInput] = useState('');
  const [ipPool, setIpPool] = useState<IpEntry[]>([]);
  const [ipModalOpen, setIpModalOpen] = useState(false);
  const [proxyType, setProxyType] = useState('Socks5');
  const [proxyChannel, setProxyChannel] = useState('IPFoxy');
  const [proxyHost, setProxyHost] = useState('');
  const [proxyPort, setProxyPort] = useState('');
  const [proxyUser, setProxyUser] = useState('');
  const [proxyPassword, setProxyPassword] = useState('');
  const batchTimerRef = useRef<number | null>(null);
  const stopRequested = useRef(false);
  const batchPortOrderRef = useRef<string[]>([]);
  const distributionPlanRef = useRef<Record<string, number>>({});
  const phonePortMapRef = useRef<Record<string, string>>({});

  const stats: SearchStats = useMemo(
    () => ({
      total: items.length,
      matched: items.filter((item) => item.status === 'matched').length,
      empty: items.filter((item) => item.status === 'empty').length,
      failed: items.filter((item) => item.status === 'failed').length,
      pending: items.filter((item) => item.status === 'pending').length,
    }),
    [items],
  );

  const completionRate = stats.total ? Math.round(((stats.total - stats.pending) / stats.total) * 100) : 0;
  const resultRows = items.filter((item) => item.status !== 'pending' || item.result);
  const pendingDocCount = dataDocs.filter((doc) => doc.name.startsWith('待筛')).reduce((total, doc) => total + doc.rows.length, 0);
  const onlinePorts = ports.filter((port) => port.status === 'ready').length;
  const nextPortNumber = ports.length ? Math.max(...ports.map((port) => port.port)) + 1 : 8787;
  const authToken = authSession?.token;
  const isSuperAdmin = authSession?.user?.role === 'super_admin';

  const replaceItems = (nextItems: QueryItem[]) => {
    stopRequested.current = false;
    setItems(nextItems);
    setActiveIndex(null);
  };

  const saveCurrentAsDoc = () => {
    if (!items.length) {
      return;
    }
    const rows = items.map((item) => item.normalized);
    const doc: DataDocument = {
      id: `doc-${Date.now()}`,
      name: `数据文档-${new Date().toLocaleString()}`,
      rows,
      createdAt: new Date().toISOString(),
    };
    setDataDocs((current) => [doc, ...current]);
  };

  const loadDocToQueue = (docId: string) => {
    const doc = dataDocs.find((item) => item.id === docId);
    if (!doc) {
      return;
    }
    replaceItems(parseTxtRows(doc.rows.join('\n')));
  };

  const deleteDoc = (docId: string) => {
    setDataDocs((current) => current.filter((doc) => doc.id !== docId));
  };

  const addQueueToDedupe = () => {
    const values = items.map((item) => item.normalized).filter(Boolean);
    setDedupeLibrary((current) => [...new Set([...current, ...values])]);
  };

  const clearDedupeLibrary = () => {
    setDedupeLibrary([]);
  };

  const uploadDedupeFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const text = await file.text();
    const rows = parsePhoneLines(text);
    const unique = [...new Set(rows)];
    let unscreened = unique.filter((phone) => !dedupeLibrary.includes(phone));
    try {
      const response = await fetch(runtimeBatchUrl(runtimeBaseUrl, '/number-library/import'), {
        method: 'POST',
        headers: batchAuthHeaders(authToken, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ phones: unique }),
      });
      if (response.ok) {
        const payload = (await response.json()) as { phones?: string[]; stats?: NumberLibraryStats };
        if (Array.isArray(payload.phones)) {
          unscreened = payload.phones;
        }
        if (payload.stats) {
          setNumberLibraryStats(payload.stats);
        }
      }
    } catch {
      // fallback to local filtering when backend pipeline endpoint unavailable
    }
    const doc: DataDocument = {
      id: `doc-${Date.now()}`,
      name: `待筛-${new Date().toLocaleString()}`,
      rows: unscreened,
      createdAt: new Date().toISOString(),
    };
    setDataDocs((current) => [doc, ...current]);
    // Auto push deduped phones into task manager pending window.
    setRunnerDocId('');
    setRunnerInput(unscreened.join('\n'));
    setRunnerNotice(`号码库入库完成：原始 ${rows.length} 条，去重后新增 ${unscreened.length} 条（自动计入未发送）。`);
    setActivePage('runner');
    event.target.value = '';
  };

  const fetchNumberLibraryStats = async () => {
    const response = await fetch(runtimeBatchUrl(runtimeBaseUrl, '/number-library/stats'), {
      headers: batchAuthHeaders(authToken),
    });
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as { total?: number; unsent?: number };
    setNumberLibraryStats({
      total: Number(payload.total ?? 0),
      unsent: Number(payload.unsent ?? 0),
    });
  };

  const exportNumberLibrary = async () => {
    const response = await fetch(runtimeBatchUrl(runtimeBaseUrl, '/number-library/export'), {
      headers: batchAuthHeaders(authToken),
    });
    if (!response.ok) {
      throw new Error(`导出号码库失败：${response.status}`);
    }
    const payload = (await response.json()) as { phones?: string[] };
    const rows = Array.isArray(payload.phones) ? payload.phones : [];
    const blob = new Blob([rows.join('\n')], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `number-library-${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const takeNumbersFromLibrary = async (count: number) => {
    const response = await fetch(runtimeBatchUrl(runtimeBaseUrl, '/number-library/take'), {
      method: 'POST',
      headers: batchAuthHeaders(authToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ count }),
    });
    if (!response.ok) {
      throw new Error(`从号码库取号失败：${response.status}`);
    }
    const payload = (await response.json()) as { phones?: string[]; stats?: NumberLibraryStats };
    if (payload.stats) {
      setNumberLibraryStats(payload.stats);
    }
    return Array.isArray(payload.phones) ? payload.phones : [];
  };

  const fetchPipelineStatus = async () => {
    const response = await fetch(runtimeBatchUrl(runtimeBaseUrl, '/pipeline/status'), {
      headers: batchAuthHeaders(authToken),
    });
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as { history: number; pending: number; inflight: number; completed: number; logs?: PipelineStatus['logs'] };
    setPipelineStatus({
      history: payload.history ?? 0,
      pending: payload.pending ?? 0,
      inflight: payload.inflight ?? 0,
      completed: payload.completed ?? 0,
      logs: payload.logs ?? [],
    });
  };

  const fetchReportSummary = async () => {
    const response = await fetch(runtimeBatchUrl(runtimeBaseUrl, '/reports/summary'), {
      headers: batchAuthHeaders(authToken),
    });
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as ReportSummary & { success?: boolean };
    setReportSummary({
      totals: payload.totals ?? { batches: 0, total: 0, processed: 0, hit: 0, failed: 0 },
      byPort: payload.byPort ?? [],
      byErrorType: payload.byErrorType ?? {},
      recent: payload.recent ?? [],
    });
  };

  const fetchSystemStatus = async () => {
    const response = await fetch(runtimeBatchUrl(runtimeBaseUrl, '/system/status'), {
      headers: batchAuthHeaders(authToken),
    });
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as SystemStatus & { success?: boolean };
    setSystemStatus(payload);
  };

  const fetchSubAccounts = async () => {
    if (!isSuperAdmin || !authToken) {
      setSubAccounts([]);
      return;
    }
    const response = await fetch(runtimeBatchUrl(runtimeBaseUrl, '/admin/subaccounts'), {
      headers: batchAuthHeaders(authToken),
    });
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as { rows?: AuthUser[] };
    setSubAccounts(payload.rows ?? []);
  };

  const fetchAuditRows = async () => {
    if (!authToken) {
      setAuditRows([]);
      return;
    }
    const response = await fetch(runtimeBatchUrl(runtimeBaseUrl, '/admin/audit'), {
      headers: batchAuthHeaders(authToken),
    });
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as { rows?: AuditLogRow[] };
    setAuditRows(payload.rows ?? []);
  };

  const login = async () => {
    setLoginError('');
    try {
      const response = await fetch(runtimeBatchUrl(runtimeBaseUrl, authApiPath('/auth/login')), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginUsername.trim(),
          password: loginPassword,
          deviceId: typeof navigator !== 'undefined' ? navigator.userAgent : 'desktop',
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        token?: string;
        refreshToken?: string;
        expiresAt?: string;
        user?: AuthUser;
      };
      if (!response.ok || !payload.success || !payload.token || !payload.user) {
        setLoginError(mapLoginApiError(payload.error, response.status));
        return;
      }
      const nextSession: AuthSession = {
        token: payload.token,
        refreshToken: payload.refreshToken ?? '',
        expiresAt: payload.expiresAt ?? '',
        user: payload.user,
      };
      setAuthSession(nextSession);
      window.localStorage.setItem('qe-auth-session', JSON.stringify(nextSession));
      setLoginPassword('');
      setActivePage('dashboard');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLoginError(`网络错误，无法连接后端：${message}`);
    }
  };

  const logout = async () => {
    try {
      if (authToken) {
        await fetch(runtimeBatchUrl(runtimeBaseUrl, authApiPath('/auth/logout')), {
          method: 'POST',
          headers: batchAuthHeaders(authToken, { 'Content-Type': 'application/json' }),
        });
      }
    } catch {
      // ignore
    }
    setAuthSession(null);
    setAuditRows([]);
    setSubAccounts([]);
    window.localStorage.removeItem('qe-auth-session');
  };

  const createSubAccount = async () => {
    if (!isSuperAdmin || !authToken || !newSubUsername.trim() || !newSubPassword) {
      return;
    }
    const response = await fetch(runtimeBatchUrl(runtimeBaseUrl, '/admin/subaccounts'), {
      method: 'POST',
      headers: batchAuthHeaders(authToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        username: newSubUsername.trim(),
        password: newSubPassword,
        role: 'sub_user',
      }),
    });
    if (!response.ok) {
      return;
    }
    setNewSubUsername('');
    setNewSubPassword('');
    await fetchSubAccounts();
    await fetchAuditRows();
  };

  const setSubAccountStatus = async (username: string, status: 'active' | 'disabled') => {
    if (!isSuperAdmin || !authToken) {
      return;
    }
    const response = await fetch(runtimeBatchUrl(runtimeBaseUrl, '/admin/subaccounts/status'), {
      method: 'POST',
      headers: batchAuthHeaders(authToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ username, status }),
    });
    if (!response.ok) {
      return;
    }
    await fetchSubAccounts();
    await fetchAuditRows();
  };

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const text = await file.text();
    const parsed = parseTxtRows(text);
    replaceItems(parsed);
    setDataDocs((current) => [
      {
        id: `doc-${Date.now()}`,
        name: file.name || `数据文档-${new Date().toLocaleString()}`,
        rows: parsed.map((item) => item.normalized),
        createdAt: new Date().toISOString(),
      },
      ...current,
    ]);
    setActivePage('data');
    event.target.value = '';
  };

  const addManualQuery = () => {
    const rows = parseTxtRows(manualValue);
    if (!rows.length) {
      return;
    }

    setItems((current) => [...current, ...rows]);
    setManualValue('');
  };

  const resetWorkspace = () => {
    stopRequested.current = true;
    setIsRunning(false);
    setActiveIndex(null);
    setItems([]);
  };

  const updateItem = (id: string, patch: Partial<QueryItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const confirmCandidate = async (item: QueryItem, candidate: Candidate) => {
    if (!candidate.qq || reviewSubmittingId) {
      return;
    }
    setReviewSubmittingId(item.id);
    try {
      const endpoint = runtimeEndpoint(runtimeBaseUrl, 'feedback');
      if (endpoint) {
        await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: item.normalized,
            qq: candidate.qq,
            name: candidate.name ?? '',
          }),
        });
      }

      updateItem(item.id, {
        result: item.result
          ? {
              ...item.result,
              qq: candidate.qq,
              email: `${candidate.qq}@qq.com`,
              decision: 'auto-pass',
              opened: true,
              category: '开通',
              summary: `${item.result.summary} 已人工确认候选并回灌样本。`,
              tags: [...new Set([...(item.result.tags ?? []), 'manual-confirm'])],
            }
          : item.result,
      });
    } catch (error) {
      updateItem(item.id, {
        error: error instanceof Error ? error.message : '候选确认失败',
      });
    } finally {
      setReviewSubmittingId(null);
    }
  };

  const runSearch = async () => {
    if (isRunning || !items.some((item) => item.status === 'pending' || item.status === 'failed')) {
      return;
    }

    stopRequested.current = false;
    setIsRunning(true);
    const queue = items.filter((item) => item.status === 'pending' || item.status === 'failed');

    for (const item of queue) {
      if (stopRequested.current) {
        break;
      }

      setActiveIndex(items.findIndex((candidate) => candidate.id === item.id));
      updateItem(item.id, { status: 'running', error: undefined });

      try {
        const result = await searchQuery(item.normalized, runtimeBaseUrl);
        updateItem(item.id, result ? { status: 'matched', result } : { status: 'empty', result: undefined });
      } catch (error) {
        updateItem(item.id, {
          status: 'failed',
          error: error instanceof Error ? error.message : '搜索失败',
        });
      }
    }

    setIsRunning(false);
    setActiveIndex(null);
  };

  const stopBatchPolling = () => {
    if (batchTimerRef.current) {
      window.clearInterval(batchTimerRef.current);
      batchTimerRef.current = null;
    }
  };

  const fetchBatchStatus = async (id: string) => {
    const response = await fetch(runtimeBatchUrl(runtimeBaseUrl, `/batch/${id}/status`), {
      headers: batchAuthHeaders(authToken),
    });
    if (!response.ok) {
      throw new Error(`批次状态获取失败：${response.status}`);
    }
    const data = (await response.json()) as BatchStatus & { success?: boolean };
    setBatchStatus(data);
    const currentPortOrder = batchPortOrderRef.current;
    const currentDistributionPlan = distributionPlanRef.current;
    const currentPhonePortMap = phonePortMapRef.current;
    if (currentPortOrder.length && data.records?.length) {
      const processedByPort: Record<string, number> = {};
      const latestByPort: Record<string, PortOutput> = {};
      currentPortOrder.forEach((portId) => {
        processedByPort[portId] = 0;
      });
      data.records.forEach((record, index) => {
        const portId = currentPhonePortMap[record.phone] ?? currentPortOrder[index % currentPortOrder.length];
        processedByPort[portId] = (processedByPort[portId] ?? 0) + 1;
        latestByPort[portId] = {
          phone: record.phone,
          text: record.opened && record.qq ? `${record.phone}：${record.qq}` : `${record.phone}：无结果`,
        };
      });
      setPortProgress((current) => {
        const next: Record<string, PortProgress> = { ...current };
        Object.entries(currentDistributionPlan).forEach(([portId, assigned]) => {
          next[portId] = { assigned, processed: processedByPort[portId] ?? 0 };
        });
        return next;
      });
      setPortOutputs((current) => ({ ...current, ...latestByPort }));
    }
    if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
      stopBatchPolling();
      setBatchRunning(false);
    }
  };

  const fetchPortRuntimeSnapshot = async () => {
    const response = await fetch(runtimeBatchUrl(runtimeBaseUrl, '/ports/snapshot'), {
      headers: batchAuthHeaders(authToken),
    });
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as { rows?: PortRuntimeRow[] };
    setPortRuntimeRows(payload.rows ?? []);
  };

  const fetchIpReserveSnapshot = async () => {
    const response = await fetch(runtimeBatchUrl(runtimeBaseUrl, '/ip/reserve'), {
      headers: batchAuthHeaders(authToken),
    });
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as { rows?: IpReserveRow[] };
    setIpReserveRows(payload.rows ?? []);
  };

  const pauseBatchRun = async (targetBatchId?: string) => {
    const nextBatchId = targetBatchId || batchId;
    if (!nextBatchId) {
      return;
    }
    const response = await fetch(runtimeBatchUrl(runtimeBaseUrl, `/batch/${nextBatchId}/pause`), {
      method: 'POST',
      headers: batchAuthHeaders(authToken, { 'Content-Type': 'application/json' }),
    });
    if (!response.ok) {
      throw new Error(`暂停批次失败：${response.status}`);
    }
    await fetchBatchStatus(nextBatchId);
  };

  const resumeBatchRun = async (targetBatchId?: string) => {
    const nextBatchId = targetBatchId || batchId;
    if (!nextBatchId) {
      return;
    }
    const response = await fetch(runtimeBatchUrl(runtimeBaseUrl, `/batch/${nextBatchId}/resume`), {
      method: 'POST',
      headers: batchAuthHeaders(authToken, { 'Content-Type': 'application/json' }),
    });
    if (!response.ok) {
      throw new Error(`继续批次失败：${response.status}`);
    }
    await fetchBatchStatus(nextBatchId);
  };

  const setPortPaused = async (portId: string, paused: boolean) => {
    const action = paused ? 'pause' : 'resume';
    const response = await fetch(runtimeBatchUrl(runtimeBaseUrl, `/ports/${portId}/${action}`), {
      method: 'POST',
      headers: batchAuthHeaders(authToken, { 'Content-Type': 'application/json' }),
    });
    if (!response.ok) {
      throw new Error(`${paused ? '暂停' : '继续'}端口失败：${response.status}`);
    }
    await fetchPortRuntimeSnapshot();
  };

  const stopBatchRun = async (targetBatchId?: string) => {
    const nextBatchId = targetBatchId || batchId;
    if (!nextBatchId) {
      return;
    }
    const response = await fetch(runtimeBatchUrl(runtimeBaseUrl, `/batch/${nextBatchId}/stop`), {
      method: 'POST',
      headers: batchAuthHeaders(authToken, { 'Content-Type': 'application/json' }),
    });
    if (!response.ok) {
      throw new Error(`停止批次失败：${response.status}`);
    }
    setBatchRunning(false);
    await fetchBatchStatus(nextBatchId);
  };

  const startBatchRun = async (
    incomingPhones: string[],
    options?: {
      dedicatedAssignments?: Record<string, string>;
      squads?: Array<{ id: string; portIds: string[]; phones: string[] }>;
      overridePortIds?: string[];
      overrideMode?: 'direct' | 'hybrid' | 'browser';
      overrideHttpConcurrencyPerWorker?: number;
    },
  ) => {
    if (batchRunning) {
      return;
    }
    try {
      setRunnerNotice('');
      const sourcePhones = incomingPhones;
      const uniquePhones = [...new Set(sourcePhones)];
      const phones = uniquePhones.filter((phone) => !dedupeLibrary.includes(phone));
      if (!phones.length) {
        const msg = '本批次号码在二次去重后为 0 条，请先上传新号码或清理去重库。';
        setRunnerNotice(msg);
        window.alert(msg);
        return;
      }

      const preferredPortIds = options?.overridePortIds?.length ? options.overridePortIds : selectedPortIds;
      const activePortIds = (preferredPortIds.length ? preferredPortIds : ports.map((port) => port.id)).filter((portId) =>
        ports.some((port) => port.id === portId && port.status !== 'offline'),
      );
      const usedPortIds = activePortIds.length ? activePortIds : ports.filter((port) => port.status !== 'offline').map((port) => port.id);
      if (!usedPortIds.length) {
        throw new Error('没有可用端口，请先开启至少一个端口');
      }
      const plan: Record<string, number> = {};
      const localPhonePortMap: Record<string, string> = {};
      usedPortIds.forEach((portId) => {
        plan[portId] = 0;
      });
      phones.forEach((phone, index) => {
        const portId = usedPortIds[index % usedPortIds.length];
        plan[portId] = (plan[portId] ?? 0) + 1;
        localPhonePortMap[phone] = portId;
      });
      setDistributionPlan(plan);
      setBatchPortOrder(usedPortIds);
      setPhonePortMap(localPhonePortMap);
      distributionPlanRef.current = plan;
      batchPortOrderRef.current = usedPortIds;
      phonePortMapRef.current = localPhonePortMap;
      setPortOutputs(
        Object.fromEntries(
          usedPortIds.map((portId) => [
            portId,
            {
              phone: '',
              text: `待执行：${plan[portId]} 条`,
            },
          ]),
        ),
      );
      setPortProgress(
        Object.fromEntries(Object.entries(plan).map(([portId, assigned]) => [portId, { assigned, processed: 0 }])),
      );
      setPlanSummary({ raw: sourcePhones.length, unique: uniquePhones.length, unscreened: phones.length });
      setDedupeLibrary((current) => [...new Set([...current, ...phones])]);

      setBatchRunning(true);
      setBatchRows([]);
      setBatchStatus(null);
      const effectiveMode = options?.overrideMode ?? batchMode;
      const effectiveHttpConcurrency = options?.overrideHttpConcurrencyPerWorker ?? httpConcurrencyPerWorker;
      const response = await fetch(runtimeBatchUrl(runtimeBaseUrl, '/pipeline/import-and-start'), {
        method: 'POST',
        headers: batchAuthHeaders(authToken, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          phones,
          workerCount: usedPortIds.length,
          portIds: usedPortIds,
          mode: effectiveMode,
          httpConcurrencyPerWorker: effectiveHttpConcurrency,
          dedicatedAssignments: options?.dedicatedAssignments ?? {},
          squads: options?.squads ?? [],
        }),
      });
      if (!response.ok) {
        throw new Error(`批次启动失败：${response.status}`);
      }
      const payload = (await response.json()) as {
        success?: boolean;
        selfCheckPass?: boolean;
        selfCheck?: Record<string, boolean>;
        import?: { total: number; accepted: number; deduped: number };
        batch?: {
          batchId: string;
          workerCount?: number;
          mode?: string;
          httpConcurrencyPerWorker?: number;
          distribution?: Record<string, number>;
        } | null;
      };
      if (!payload.selfCheckPass) {
        setBatchRunning(false);
        setSelfCheckSummary('集体自检未通过，请先检查端口/IP/引擎状态。');
        return;
      }
      setSelfCheckSummary(
        `集体自检通过；导入 ${payload.import?.total ?? phones.length} 条，接受 ${payload.import?.accepted ?? phones.length} 条，去重 ${payload.import?.deduped ?? 0} 条。`,
      );
      if (!payload.batch?.batchId) {
        setBatchRunning(false);
        setRunnerNotice('没有可执行的新任务（去重后为 0）。');
        return;
      }
      setBatchId(payload.batch.batchId);
      if (payload.batch.distribution) {
        setDistributionPlan(payload.batch.distribution);
      }
      setRunnerNotice(
        `批次已启动：${payload.batch.batchId}（并发线数 ${payload.batch.workerCount ?? usedPortIds.length}，模式 ${payload.batch.mode ?? effectiveMode}，端口HTTP并发 ${payload.batch.httpConcurrencyPerWorker ?? effectiveHttpConcurrency}）`,
      );
      await fetchBatchStatus(payload.batch.batchId);
      await fetchPortRuntimeSnapshot();
      stopBatchPolling();
      batchTimerRef.current = window.setInterval(() => {
        void fetchBatchStatus(payload.batch!.batchId).catch((error) => {
          setRunnerNotice(error instanceof Error ? error.message : '批次状态轮询失败');
        });
      }, 1800);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '批次启动失败';
      setRunnerNotice(msg);
      setBatchRunning(false);
      batchPortOrderRef.current = [];
      distributionPlanRef.current = {};
      phonePortMapRef.current = {};
      window.alert(msg);
    }
  };

  const exportBatchRows = async () => {
    if (!batchId) {
      return;
    }
    const response = await fetch(runtimeBatchUrl(runtimeBaseUrl, `/batch/${batchId}/export?format=json`), {
      headers: batchAuthHeaders(authToken),
    });
    if (!response.ok) {
      throw new Error(`批次导出失败：${response.status}`);
    }
    const data = (await response.json()) as { rows?: BatchRow[] };
    const rows = data.rows ?? [];
    setBatchRows(rows);
    const headers = ['手机号', 'QQ号', '查询时间', '重试次数'];
    const csv = [headers, ...rows.map((row) => [row.phone, row.qq, row.query_time, row.retry_count])]
      .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `batch-hits-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  useEffect(
    () => () => {
      stopBatchPolling();
    },
    [],
  );

  useEffect(() => {
    const verifySession = async () => {
      if (!authSession?.token) {
        setAuthLoading(false);
        return;
      }
      const ctrl = new AbortController();
      const tid = window.setTimeout(() => ctrl.abort(), 12000);
      try {
        const response = await fetch(runtimeBatchUrl(runtimeBaseUrl, authApiPath('/auth/me')), {
          headers: batchAuthHeaders(authSession.token),
          signal: ctrl.signal,
        });
        if (response.status === 401 || response.status === 403) {
          setAuthSession(null);
          window.localStorage.removeItem('qe-auth-session');
        } else if (response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { user?: AuthUser };
          if (payload.user) {
            setAuthSession((current) => (current ? { ...current, user: payload.user! } : current));
          }
        }
      } catch {
        // 网络/超时：不删本地 token，避免永远卡在「系统安全校验中」；进系统后若 token 无效再登录即可
      } finally {
        window.clearTimeout(tid);
        setAuthLoading(false);
      }
    };
    void verifySession();
  }, []);

  useEffect(() => {
    if (!authToken) {
      return;
    }
    void fetchPipelineStatus();
    void fetchPortRuntimeSnapshot();
    void fetchIpReserveSnapshot();
    void fetchReportSummary();
    void fetchSystemStatus();
    void fetchNumberLibraryStats();
    void fetchAuditRows();
    void fetchSubAccounts();
    const timer = window.setInterval(() => {
      void fetchPipelineStatus();
      void fetchPortRuntimeSnapshot();
      void fetchIpReserveSnapshot();
      void fetchReportSummary();
      void fetchSystemStatus();
      void fetchNumberLibraryStats();
      void fetchAuditRows();
      void fetchSubAccounts();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [runtimeBaseUrl, authToken, isSuperAdmin]);

  useEffect(() => {
    if (manualPortSelection) {
      return;
    }
    setSelectedPortIds(ports.filter((port) => port.status !== 'offline').map((port) => port.id));
  }, [ports, manualPortSelection]);

  useEffect(() => {
    if (!ipPool.length || !ports.length) {
      return;
    }
    setPorts((current) =>
      current.map((port, index) => {
        if (port.boundIp) {
          return port;
        }
        return { ...port, boundIp: ipPool[index % ipPool.length].value };
      }),
    );
  }, [ipPool.length]);

  useEffect(() => {
    if (!batchRunning || !batchStatus) {
      return;
    }
    if (batchStatus.status === 'failed') {
      addPort();
      setRunnerNotice((current) => `${current ? `${current}；` : ''}检测到故障，已自动补充新端口接替后续任务。`);
    }
  }, [batchStatus?.status]);

  const stopSearch = () => {
    stopRequested.current = true;
    setIsRunning(false);
  };

  const exportResults = () => {
    const blob = new Blob([`\uFEFF${toCsv(items)}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `qe-results-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const addPort = () => {
    const isFirstPort = ports.length === 0;
    const port: EmulatorPort = {
      id: `port-${Date.now()}`,
      name: `QQ端口 ${String(ports.length + 1).padStart(2, '0')}`,
      port: nextPortNumber,
      status: 'ready',
      accountStatus: 'abnormal',
      qqInstalled: true,
      account: '未登录',
      note: '',
      boundIp: '',
      source: isFirstPort ? 'base-download' : 'cloned',
    };

    setPorts((current) => [...current, port]);
  };

  const clonePort = (sourcePort: EmulatorPort) => {
    const port: EmulatorPort = {
      id: `port-${Date.now()}`,
      name: `QQ端口 ${String(ports.length + 1).padStart(2, '0')}`,
      port: nextPortNumber,
      status: 'ready',
      accountStatus: 'abnormal',
      qqInstalled: sourcePort.qqInstalled,
      account: '未登录',
      note: '',
      boundIp: '',
      source: 'cloned',
    };

    setPorts((current) => [...current, port]);
  };

  const deletePort = (id: string) => {
    setPorts((current) => current.filter((port) => port.id !== id));
  };

  const updatePort = (id: string, patch: Partial<EmulatorPort>) => {
    setPorts((current) => current.map((port) => (port.id === id ? { ...port, ...patch } : port)));
  };

  const togglePortPower = (id: string) => {
    setPorts((current) =>
      current.map((port) => (port.id === id ? { ...port, status: port.status === 'offline' ? 'ready' : 'offline' } : port)),
    );
  };

  const addSingleIp = () => {
    const host = proxyHost.trim();
    const port = proxyPort.trim();
    if (!host || !port) {
      window.alert('请先填写主机和端口');
      return;
    }
    const auth = proxyUser.trim() ? `${proxyUser.trim()}:${proxyPassword.trim()}@` : '';
    const value = `socks5://${auth}${host}:${port}`;
    if (!value) {
      return;
    }
    if (!socks5Pattern.test(value)) {
      window.alert('IP格式错误，请使用 socks5://user:pass@host:port');
      return;
    }
    setIpPool((current) =>
      current.some((item) => item.value === value)
        ? current
        : [...current, { value, status: 'unchecked' }],
    );
    setProxyHost('');
    setProxyPort('');
    setProxyUser('');
    setProxyPassword('');
    setIpModalOpen(false);
  };

  const importBatchIps = () => {
    const values = parseSocks5Input(ipInput);
    if (!values.length) {
      return;
    }
    const valid = values.filter((item) => socks5Pattern.test(item));
    const invalidCount = values.length - valid.length;
    if (!valid.length) {
      window.alert('没有可导入的 socks5 IP，请检查格式。');
      return;
    }
    setIpPool((current) => {
      const merged = [...current];
      for (const value of valid) {
        if (!merged.some((item) => item.value === value)) {
          merged.push({ value, status: 'unchecked' });
        }
      }
      return merged;
    });
    setIpInput('');
    setIpModalOpen(false);
    if (invalidCount > 0) {
      window.alert(`已导入 ${valid.length} 条，忽略 ${invalidCount} 条非 socks5 格式。`);
    }
  };

  const removeIp = (value: string) => {
    setIpPool((current) => current.filter((item) => item.value !== value));
  };

  const detectSingleIp = async (value: string) => {
    setIpPool((current) =>
      current.map((item) => (item.value === value ? { ...item, status: 'checking', error: '' } : item)),
    );
    try {
      const response = await fetch(runtimeBatchUrl(runtimeBaseUrl, '/batch/proxy/check'), {
        method: 'POST',
        headers: batchAuthHeaders(authToken, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ proxy: value }),
      });
      if (!response.ok) {
        throw new Error(`检测失败：${response.status}`);
      }
      const data = (await response.json()) as {
        rows?: Array<{ proxy: string; ok: boolean; latency_ms?: number; checked_at?: string; error?: string }>;
      };
      const row = data.rows?.[0];
      setIpPool((current) =>
        current.map((item) =>
          item.value === value
            ? {
                ...item,
                status: row?.ok ? 'ok' : 'failed',
                latencyMs: row?.latency_ms,
                checkedAt: row?.checked_at,
                error: row?.error ?? '',
              }
            : item,
        ),
      );
    } catch (error) {
      setIpPool((current) =>
        current.map((item) =>
          item.value === value
            ? {
                ...item,
                status: 'failed',
                error: error instanceof Error ? error.message : '检测失败',
              }
            : item,
        ),
      );
    }
  };

  const detectAllIps = async () => {
    if (!ipPool.length) {
      return;
    }
    setIpPool((current) => current.map((item) => ({ ...item, status: 'checking', error: '' })));
    try {
      const response = await fetch(runtimeBatchUrl(runtimeBaseUrl, '/batch/proxy/check'), {
        method: 'POST',
        headers: batchAuthHeaders(authToken, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ proxies: ipPool.map((item) => item.value) }),
      });
      if (!response.ok) {
        throw new Error(`批量检测失败：${response.status}`);
      }
      const data = (await response.json()) as {
        rows?: Array<{ proxy: string; ok: boolean; latency_ms?: number; checked_at?: string; error?: string }>;
      };
      const map = new Map((data.rows ?? []).map((row) => [row.proxy, row]));
      setIpPool((current) =>
        current.map((item) => {
          const row = map.get(item.value);
          if (!row) {
            return { ...item, status: 'failed', error: '未返回检测结果' };
          }
          return {
            ...item,
            status: row.ok ? 'ok' : 'failed',
            latencyMs: row.latency_ms,
            checkedAt: row.checked_at,
            error: row.error ?? '',
          };
        }),
      );
    } catch (error) {
      setIpPool((current) =>
        current.map((item) => ({
          ...item,
          status: 'failed',
          error: error instanceof Error ? error.message : '批量检测失败',
        })),
      );
    }
  };

  const initializePort = (id: string) => {
    setPorts((current) =>
      current.map((port) =>
        port.id === id ? { ...port, account: '未登录', accountStatus: 'abnormal', status: 'ready' } : port,
      ),
    );
  };

  const markPortLoggedIn = (id: string, account: string) => {
    setPorts((current) =>
      current.map((port) =>
        port.id === id
          ? {
              ...port,
              account: account || `${port.name.replace(/\s/g, '')}@qq`,
              accountStatus: 'normal',
              status: 'ready',
            }
          : port,
      ),
    );
  };

  const renderPage = () => {
    switch (activePage) {
      case 'data':
        return (
          <DataPage
            dataDocs={dataDocs}
            numberLibraryStats={numberLibraryStats}
            deleteDoc={deleteDoc}
            loadDocToQueue={loadDocToQueue}
            uploadDedupeFile={uploadDedupeFile}
            exportNumberLibrary={exportNumberLibrary}
          />
        );
      case 'accounts':
        return (
          <AccountPage
            addPort={addPort}
            clonePort={clonePort}
            deletePort={deletePort}
            portOutputs={portOutputs}
            ports={ports}
            portProgress={portProgress}
            togglePortPower={togglePortPower}
            updatePort={updatePort}
          />
        );
      case 'ipPool':
        return (
          <IpPoolPage
            ipInput={ipInput}
            ipModalOpen={ipModalOpen}
            ipPool={ipPool}
            ports={ports}
            setIpInput={setIpInput}
            setIpModalOpen={setIpModalOpen}
            proxyChannel={proxyChannel}
            proxyHost={proxyHost}
            proxyPassword={proxyPassword}
            proxyPort={proxyPort}
            proxyType={proxyType}
            proxyUser={proxyUser}
            addSingleIp={addSingleIp}
            detectAllIps={detectAllIps}
            detectSingleIp={detectSingleIp}
            importBatchIps={importBatchIps}
            removeIp={removeIp}
            setProxyChannel={setProxyChannel}
            setProxyHost={setProxyHost}
            setProxyPassword={setProxyPassword}
            setProxyPort={setProxyPort}
            setProxyType={setProxyType}
            setProxyUser={setProxyUser}
            updatePort={updatePort}
          />
        );
      case 'runner':
        return (
          <TaskCenterPage
            authToken={authToken}
            dataDocs={dataDocs}
            ipPool={ipPool}
            ports={ports}
            runtimeBaseUrl={runtimeBaseUrl}
            startBatchRun={startBatchRun}
            pauseBatchRun={pauseBatchRun}
            resumeBatchRun={resumeBatchRun}
            stopBatchRun={stopBatchRun}
            takeNumbersFromLibrary={takeNumbersFromLibrary}
            updatePort={updatePort}
          />
        );
      case 'security':
        return (
          <SecurityPage
            isSuperAdmin={isSuperAdmin}
            subAccounts={subAccounts}
            auditRows={auditRows}
            newSubUsername={newSubUsername}
            newSubPassword={newSubPassword}
            setNewSubUsername={setNewSubUsername}
            setNewSubPassword={setNewSubPassword}
            createSubAccount={createSubAccount}
            setSubAccountStatus={setSubAccountStatus}
          />
        );
      default:
        return (
          <DashboardPage
            pendingCount={pipelineStatus.pending || (batchStatus ? Math.max(0, batchStatus.total - batchStatus.processed) : pendingDocCount)}
            processedCount={pipelineStatus.completed || (batchStatus?.processed ?? 0)}
            hitCount={batchStatus?.hit ?? 0}
            logs={pipelineStatus.logs}
            reportSummary={reportSummary}
            systemStatus={systemStatus}
          />
        );
    }
  };

  if (authLoading) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <h2>系统安全校验中...</h2>
        </section>
      </main>
    );
  }

  if (!authSession) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <p className="section-kicker">Secure Access Gateway</p>
          <h1>QE Intelligence Console</h1>
          <p className="muted-copy">需要账号密码登录后才能进入系统。</p>
          <div className="runtime-config-form">
            <input value={loginUsername} onChange={(event) => setLoginUsername(event.target.value)} placeholder="账号" />
            <input
              type="password"
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
              placeholder="密码"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void login();
                }
              }}
            />
          </div>
          {loginError ? <div className="connector-note">{loginError}</div> : null}
          <div className="action-row">
            <button className="run-button" type="button" onClick={() => void login()}>
              进入系统
            </button>
          </div>
        </section>
      </main>
    );
  }

  const visibleNavItems = navItems.filter((item) => (item.key === 'security' ? isSuperAdmin : true));

  return (
    <main className="console-shell">
      <aside className="sidebar">
        <div className="brand-card">
          <div className="brand-logo">渣狗</div>
          <div className="brand-meta">
            <a className="brand-tg-button" href={tgLink} target="_blank" rel="noreferrer">
              TG: @zz522377
            </a>
            <small className="brand-warning">私聊你转账的都可以直接拉黑，必定不是我</small>
          </div>
        </div>

        <nav className="main-nav">
          {visibleNavItems.map((item) => (
            <button
              className={`nav-item ${activePage === item.key ? 'nav-item--active' : ''}`}
              key={item.key}
              onClick={() => setActivePage(item.key)}
              type="button"
            >
              {item.icon}
              <span>
                <strong>{item.label}</strong>
                <small>{item.desc}</small>
              </span>
            </button>
          ))}
        </nav>

        <div className="sidebar-status">
          <span className="pulse-dot" />
          <div>
            <strong>{onlinePorts} 个端口在线</strong>
            <small>{authSession.user.username} ({authSession.user.role})</small>
          </div>
        </div>

        <div className="sidebar-footer">
          <button className="sidebar-logout" type="button" onClick={() => void logout()}>
            退出登录
          </button>
        </div>
      </aside>

      <section className="content-shell content-shell--white">
        {renderPage()}
      </section>
    </main>
  );
}

function DashboardPage({
  pendingCount,
  processedCount,
  hitCount,
  logs,
  reportSummary,
  systemStatus,
}: {
  pendingCount: number;
  processedCount: number;
  hitCount: number;
  logs: PipelineStatus['logs'];
  reportSummary: ReportSummary | null;
  systemStatus: SystemStatus | null;
}) {
  const recentLogs = [...logs].slice(-120).reverse();
  const reportTotals = reportSummary?.totals;
  const recommend = systemStatus?.recommendation;

  return (
    <div className="page-stack">
      <section className="summary-grid">
        <MetricCard icon={<Play />} label="待筛" value={pendingCount} />
        <MetricCard icon={<Activity />} label="已筛" value={processedCount} tone="success" />
        <MetricCard icon={<CheckCircle2 />} label="命中" value={hitCount} tone="success" />
        <MetricCard icon={<Gauge />} label="未命中" value={Math.max(0, processedCount - hitCount)} tone="warning" />
      </section>
      <section className="summary-grid">
        <MetricCard icon={<Bot />} label="历史批次" value={reportTotals?.batches ?? 0} />
        <MetricCard icon={<DatabaseZap />} label="累计处理" value={reportTotals?.processed ?? 0} />
        <MetricCard icon={<ShieldCheck />} label="累计失败" value={reportTotals?.failed ?? 0} tone="warning" />
        <MetricCard icon={<Monitor />} label="目标达成预测" value={recommend?.targetMet ? '可达20万' : '需扩容'} tone={recommend?.targetMet ? 'success' : 'warning'} />
      </section>
      <section className="panel settings-panel">
        <div className="panel__header compact">
          <div>
            <p className="section-kicker">本机状态监控</p>
            <h2>最佳运行建议</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>指标</th>
                <th>当前值</th>
                <th>建议值</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>CPU核心</td>
                <td>{systemStatus?.host.cpus ?? '-'}</td>
                <td>{recommend?.recommendedPorts ?? '-'}</td>
              </tr>
              <tr>
                <td>可用内存(GB)</td>
                <td>{systemStatus?.host.freeMemGb ?? '-'}</td>
                <td>{recommend?.recommendedHttpConcurrencyPerWorker ?? '-'}</td>
              </tr>
              <tr>
                <td>Runner RSS(MB)</td>
                <td>{systemStatus?.process.rssMb ?? '-'}</td>
                <td>低于 1200</td>
              </tr>
              <tr>
                <td>预估日吞吐</td>
                <td>{recommend?.estimatedDailyCapacity ?? '-'}</td>
                <td>200000+</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel settings-panel">
        <div className="panel__header compact">
          <div>
            <p className="section-kicker">报表中心</p>
            <h2>端口与错误统计</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>端口</th>
                <th>分配量</th>
                <th>在途</th>
              </tr>
            </thead>
            <tbody>
              {reportSummary?.byPort?.length ? (
                reportSummary.byPort.map((row) => (
                  <tr key={`report-${row.portId}`}>
                    <td>{row.portId}</td>
                    <td>{row.assigned}</td>
                    <td>{row.inflight}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="empty-cell">
                    暂无端口报表
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="connector-note">
          错误类型分布：
          {Object.entries(reportSummary?.byErrorType ?? {})
            .map(([key, value]) => ` ${key}:${value}`)
            .join('；') || ' 暂无'}
        </div>
      </section>
      <section className="panel settings-panel">
        <div className="panel__header compact">
          <div>
            <p className="section-kicker">日志记录</p>
            <h2>实时识别日志</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>手机号</th>
                <th>输出</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {recentLogs.length ? (
                recentLogs.map((row, index) => (
                  <tr key={`${row.phone}-${index}`}>
                    <td>{row.phone ?? '-'}</td>
                    <td>{row.result ?? '-'}</td>
                    <td>{row.type}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="empty-cell">
                    暂无日志
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function DataPage({
  dataDocs,
  numberLibraryStats,
  deleteDoc,
  loadDocToQueue,
  uploadDedupeFile,
  exportNumberLibrary,
}: {
  dataDocs: DataDocument[];
  numberLibraryStats: NumberLibraryStats;
  deleteDoc: (docId: string) => void;
  loadDocToQueue: (docId: string) => void;
  uploadDedupeFile: (event: ChangeEvent<HTMLInputElement>) => void;
  exportNumberLibrary: () => Promise<void>;
}) {
  const pendingDocs = dataDocs.filter((doc) => doc.name.startsWith('待筛'));
  return (
    <div className="page-stack">
      <section className="panel intake-panel">
        <div className="panel__header compact">
          <div>
            <p className="section-kicker">01 / 号码库</p>
            <h2>总库入库与未发送管理</h2>
          </div>
          <div className="action-row">
            <button className="soft-button" type="button" onClick={() => void exportNumberLibrary()}>
              导出我的总库
            </button>
            <label className="icon-upload">
              <UploadCloud size={17} />
              <input type="file" accept=".txt,text/plain" onChange={uploadDedupeFile} />
            </label>
          </div>
        </div>
        <div className="connector-note">
          总库数据数量：{numberLibraryStats.total}。当前未发送数量：{numberLibraryStats.unsent}。如需清空总库请联系狗渣。
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>待筛文档</th>
                <th>条数</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {pendingDocs.length ? (
                pendingDocs.map((doc) => (
                  <tr key={doc.id}>
                    <td>{doc.name}</td>
                    <td>{doc.rows.length}</td>
                    <td className="action-row">
                      <button className="soft-button" type="button" onClick={() => loadDocToQueue(doc.id)}>
                        载入
                      </button>
                      <button className="soft-button danger" type="button" onClick={() => deleteDoc(doc.id)}>
                        删除
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="empty-cell">
                    暂无待筛文档
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function OpenedPhoneTable({ resultRows }: { resultRows: QueryItem[] }) {
  const rows = resultRows
    .filter((item) => item.result?.opened === true)
    .map((item) => ({
      phone: item.normalized,
      email: item.result?.email ?? (item.result?.qq ? `${item.result.qq}@qq.com` : ''),
    }));

  return (
    <>
      <div className="connector-note">已开通手机号 + QQ邮箱（邮箱由QQ号推导）。</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>手机号</th>
              <th>QQ邮箱</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={2} className="empty-cell">
                  暂无开通手机号
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={`${row.phone}-${row.email || 'empty'}`}>
                  <td>{row.phone}</td>
                  <td>{row.email || '待确认'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ReviewTable({
  confirmCandidate,
  resultRows,
  reviewSubmittingId,
}: {
  confirmCandidate: (item: QueryItem, candidate: Candidate) => Promise<void>;
  resultRows: QueryItem[];
  reviewSubmittingId: string | null;
}) {
  const reviewRows = resultRows.filter((item) => item.result?.decision === 'review' && item.result.topCandidates?.length);
  if (!reviewRows.length) {
    return null;
  }

  return (
    <>
      <div className="connector-note">待复核候选（Top3），点击确认后会写入样本缓存并回填QQ邮箱。</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>手机号</th>
              <th>候选QQ</th>
              <th>候选昵称</th>
              <th>分数</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {reviewRows.flatMap((item) =>
              (item.result?.topCandidates ?? []).map((candidate) => (
                <tr key={`${item.id}-${candidate.qq ?? candidate.name ?? 'candidate'}`}>
                  <td>{item.normalized}</td>
                  <td>{candidate.qq || '-'}</td>
                  <td>{candidate.name || '-'}</td>
                  <td>{typeof candidate.score === 'number' ? `${Math.round(candidate.score * 100)}%` : '-'}</td>
                  <td>
                    <button
                      type="button"
                      className="soft-button"
                      disabled={!candidate.qq || reviewSubmittingId === item.id}
                      onClick={() => void confirmCandidate(item, candidate)}
                    >
                      {reviewSubmittingId === item.id ? '提交中' : '确认此候选'}
                    </button>
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AccountPage({
  addPort,
  clonePort,
  deletePort,
  portOutputs,
  ports,
  portProgress,
  togglePortPower,
  updatePort,
}: {
  addPort: () => void;
  clonePort: (port: EmulatorPort) => void;
  deletePort: (id: string) => void;
  portOutputs: Record<string, PortOutput>;
  ports: EmulatorPort[];
  portProgress: Record<string, PortProgress>;
  togglePortPower: (id: string) => void;
  updatePort: (id: string, patch: Partial<EmulatorPort>) => void;
}) {
  const maxPortSlots = 20;
  const visiblePorts = ports.slice(0, maxPortSlots);
  const emptySlots = Array.from({ length: Math.max(0, maxPortSlots - visiblePorts.length) }, (_, index) => ({
    key: `empty-${index}`,
  }));

  return (
    <div className="port-manager-layout">
      <section className="panel settings-panel">
        <div className="panel__header compact">
          <div>
            <p className="section-kicker">QE 控制台</p>
            <h2>20 端口整齐布局（仅端口管理）</h2>
          </div>
          <button className="run-button" onClick={addPort} type="button" disabled={ports.length >= maxPortSlots}>
            <Plus size={16} />
            添加端口
          </button>
        </div>
        <div className="port-grid-20">
          {visiblePorts.map((port, index) => (
            <div className="port-card" key={port.id}>
              <div className="port-card__online">
                <span className="pulse-dot" />
                <div>
                  <strong>{port.status === 'offline' ? '端口已关闭' : '端口在线'}</strong>
                  <small>Runner: /api/search</small>
                </div>
              </div>
              <div className="port-card__head">
                <strong>{port.name}</strong>
                <small>#{index + 1}</small>
              </div>
              <div className="port-card__meta">127.0.0.1:{port.port}</div>
              <input
                className="port-card__input"
                value={port.note ?? ''}
                onChange={(event) => updatePort(port.id, { note: event.target.value })}
                placeholder="备注"
              />
              <div className="port-card__meta">绑定IP：{port.boundIp || '原生IP'}</div>
              <div className="port-card__meta">
                处理进度：{portProgress[port.id]?.processed ?? 0}/{portProgress[port.id]?.assigned ?? 0}
              </div>
              <div className="port-card__meta">当前识别：{portOutputs[port.id]?.text ?? '暂无输出'}</div>
              <div className="port-card__actions">
                <button className="soft-button" type="button" onClick={() => togglePortPower(port.id)}>
                  {port.status === 'offline' ? '开启' : '关闭'}
                </button>
                <button className="soft-button" type="button" onClick={() => clonePort(port)}>
                  <Copy size={14} />
                  复制
                </button>
                <button className="soft-button danger" type="button" onClick={() => deletePort(port.id)}>
                  <Trash2 size={14} />
                  删除
                </button>
              </div>
            </div>
          ))}
          {emptySlots.map((slot) => (
            <button key={slot.key} className="port-card port-card--empty" type="button" onClick={addPort}>
              <Plus size={18} />
              添加端口
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function IpPoolPage({
  ipInput,
  ipModalOpen,
  ipPool,
  ports,
  setIpInput,
  setIpModalOpen,
  proxyChannel,
  proxyHost,
  proxyPassword,
  proxyPort,
  proxyType,
  proxyUser,
  addSingleIp,
  detectAllIps,
  detectSingleIp,
  importBatchIps,
  removeIp,
  setProxyChannel,
  setProxyHost,
  setProxyPassword,
  setProxyPort,
  setProxyType,
  setProxyUser,
  updatePort,
}: {
  ipInput: string;
  ipModalOpen: boolean;
  ipPool: IpEntry[];
  ports: EmulatorPort[];
  setIpInput: (value: string) => void;
  setIpModalOpen: (value: boolean) => void;
  proxyChannel: string;
  proxyHost: string;
  proxyPassword: string;
  proxyPort: string;
  proxyType: string;
  proxyUser: string;
  addSingleIp: () => void;
  detectAllIps: () => Promise<void>;
  detectSingleIp: (value: string) => Promise<void>;
  importBatchIps: () => void;
  removeIp: (value: string) => void;
  setProxyChannel: (value: string) => void;
  setProxyHost: (value: string) => void;
  setProxyPassword: (value: string) => void;
  setProxyPort: (value: string) => void;
  setProxyType: (value: string) => void;
  setProxyUser: (value: string) => void;
  updatePort: (id: string, patch: Partial<EmulatorPort>) => void;
}) {
  const previewRows = parseSocks5Input(ipInput).map((value) => ({
    value,
    valid: socks5Pattern.test(value),
  }));

  return (
    <div className="port-manager-layout">
      <section className="panel settings-panel">
        <div className="panel__header compact">
          <div>
            <p className="section-kicker">IP 池管理</p>
            <h2>单个/批量导入 IP</h2>
          </div>
        </div>
        <div className="action-row">
          <button className="run-button" type="button" onClick={() => setIpModalOpen(true)}>
            添加IP
          </button>
          <button className="soft-button" type="button" onClick={() => void detectAllIps()} disabled={!ipPool.length}>
            批量检测
          </button>
        </div>
        <div className="ip-chip-list">
          {ipPool.length ? (
            ipPool.map((ip) => (
              <div key={ip.value} className="ip-chip-row">
                <button className="ip-chip" type="button" onClick={() => removeIp(ip.value)}>
                  {ip.value}
                </button>
                <span className={`ip-status ip-status--${ip.status}`}>
                  {ip.status === 'ok'
                    ? `可用 ${ip.latencyMs ? `${ip.latencyMs}ms` : ''}`
                    : ip.status === 'failed'
                      ? ip.error || '不可用'
                      : ip.status === 'checking'
                        ? '检测中'
                        : '未检测'}
                </span>
                <button className="soft-button" type="button" onClick={() => void detectSingleIp(ip.value)}>
                  单个检测
                </button>
              </div>
            ))
          ) : (
            <span className="muted-copy">暂无IP，请先导入。</span>
          )}
        </div>
      </section>

      <section className="panel settings-panel">
        <div className="panel__header compact">
          <div>
            <p className="section-kicker">端口绑定</p>
            <h2>将 IP 绑定到指定端口</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>端口</th>
                <th>当前IP</th>
                <th>绑定操作</th>
              </tr>
            </thead>
            <tbody>
              {ports.map((port) => (
                <tr key={port.id}>
                  <td>{port.name}</td>
                  <td>{port.boundIp || '原生IP'}</td>
                  <td>
                    <select
                      className="port-card__select"
                      value={port.boundIp ?? ''}
                      onChange={(event) => updatePort(port.id, { boundIp: event.target.value })}
                    >
                      <option value="">不绑定</option>
                      {ipPool.map((ip) => (
                        <option key={ip.value} value={ip.value}>
                          {ip.value}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {ipModalOpen ? (
        <div className="tutorial-overlay" role="presentation" onClick={() => setIpModalOpen(false)}>
          <div className="tutorial-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="tutorial-modal__header">
              <h2>新增 IP（socks5）</h2>
              <button className="soft-button" type="button" onClick={() => setIpModalOpen(false)}>
                关闭
              </button>
            </div>
            <div className="tutorial-modal__content">
              <div className="proxy-form-grid">
                <label>代理类型</label>
                <select value={proxyType} onChange={(event) => setProxyType(event.target.value)}>
                  <option value="Socks5">Socks5</option>
                </select>

                <label>IP查询渠道</label>
                <input value={proxyChannel} onChange={(event) => setProxyChannel(event.target.value)} placeholder="IPFoxy" />

                <label>主机:端口</label>
                <div className="proxy-host-port">
                  <input value={proxyHost} onChange={(event) => setProxyHost(event.target.value)} placeholder="95.134.249.151" />
                  <span>:</span>
                  <input value={proxyPort} onChange={(event) => setProxyPort(event.target.value)} placeholder="443" />
                </div>

                <label>代理账号</label>
                <input value={proxyUser} onChange={(event) => setProxyUser(event.target.value)} placeholder="账号(可选)" />

                <label>代理密码</label>
                <input
                  value={proxyPassword}
                  onChange={(event) => setProxyPassword(event.target.value)}
                  placeholder="密码(可选)"
                />
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>代理地址</th>
                      <th>格式</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.length ? (
                      previewRows.map((row, index) => (
                        <tr key={`${row.value}-${index}`}>
                          <td>{row.value}</td>
                          <td>{row.valid ? '合法' : '非法'}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={2}>请输入 socks5 代理后可预览</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <textarea
                className="batch-input"
                value={ipInput}
                onChange={(event) => setIpInput(event.target.value)}
                placeholder="批量导入：socks5://user:pass@host:port（换行/逗号分隔）"
              />
              <div className="action-row">
                <button className="run-button" type="button" onClick={addSingleIp}>
                  添加单个IP
                </button>
                <button className="soft-button" type="button" onClick={importBatchIps}>
                  批量导入IP
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TaskCenterPage({
  authToken,
  dataDocs,
  ipPool,
  ports,
  runtimeBaseUrl,
  startBatchRun,
  pauseBatchRun,
  resumeBatchRun,
  stopBatchRun,
  takeNumbersFromLibrary,
  updatePort,
}: {
  authToken?: string;
  dataDocs: DataDocument[];
  ipPool: IpEntry[];
  ports: EmulatorPort[];
  runtimeBaseUrl: string;
  startBatchRun: (
    incomingPhones: string[],
    options?: {
      dedicatedAssignments?: Record<string, string>;
      squads?: Array<{ id: string; portIds: string[]; phones: string[] }>;
      overridePortIds?: string[];
      overrideMode?: 'direct' | 'hybrid' | 'browser';
      overrideHttpConcurrencyPerWorker?: number;
    },
  ) => Promise<void>;
  pauseBatchRun: (targetBatchId?: string) => Promise<void>;
  resumeBatchRun: (targetBatchId?: string) => Promise<void>;
  stopBatchRun: (targetBatchId?: string) => Promise<void>;
  takeNumbersFromLibrary: (count: number) => Promise<string[]>;
  updatePort: (id: string, patch: Partial<EmulatorPort>) => void;
}) {
  const [runningTasks, setRunningTasks] = useState<TaskListItem[]>([]);
  const [completedTasks, setCompletedTasks] = useState<TaskListItem[]>([]);
  const [runningPage, setRunningPage] = useState(1);
  const [completedPage, setCompletedPage] = useState(1);
  const [runningTotalPages, setRunningTotalPages] = useState(1);
  const [completedTotalPages, setCompletedTotalPages] = useState(1);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [selectedTask, setSelectedTask] = useState<BatchStatus | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState('');
  const [selectedPortIds, setSelectedPortIds] = useState<string[]>([]);
  const [ipAssignMode, setIpAssignMode] = useState<'auto' | 'manual'>('auto');
  const [manualIpMap, setManualIpMap] = useState<Record<string, string>>({});
  const [phoneInput, setPhoneInput] = useState('');
  const [libraryTakeCount, setLibraryTakeCount] = useState(0);
  const [taskNotice, setTaskNotice] = useState('');

  const fetchTaskList = async (status: 'running' | 'completed', page: number) => {
    if (!authToken) {
      return;
    }
    const response = await fetch(runtimeBatchUrl(runtimeBaseUrl, `/batch/list?status=${status}&page=${page}&pageSize=20`), {
      headers: batchAuthHeaders(authToken),
    });
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as {
      rows?: TaskListItem[];
      pagination?: { totalPages?: number };
    };
    if (status === 'running') {
      setRunningTasks(payload.rows ?? []);
      setRunningTotalPages(Math.max(1, Number(payload.pagination?.totalPages ?? 1)));
    } else {
      setCompletedTasks(payload.rows ?? []);
      setCompletedTotalPages(Math.max(1, Number(payload.pagination?.totalPages ?? 1)));
    }
  };

  const fetchTaskStatus = async (taskId: string) => {
    if (!taskId || !authToken) {
      return;
    }
    const response = await fetch(runtimeBatchUrl(runtimeBaseUrl, `/batch/${taskId}/status`), {
      headers: batchAuthHeaders(authToken),
    });
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as BatchStatus;
    setSelectedTask(payload);
  };

  useEffect(() => {
    setSelectedPortIds(ports.filter((port) => port.status !== 'offline').map((port) => port.id));
  }, [ports]);

  useEffect(() => {
    void fetchTaskList('running', runningPage);
  }, [runningPage, runtimeBaseUrl, authToken]);

  useEffect(() => {
    void fetchTaskList('completed', completedPage);
  }, [completedPage, runtimeBaseUrl, authToken]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetchTaskList('running', runningPage);
      void fetchTaskList('completed', completedPage);
      if (selectedTaskId) {
        void fetchTaskStatus(selectedTaskId);
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [runningPage, completedPage, selectedTaskId, runtimeBaseUrl, authToken]);

  const onSelectTask = (taskId: string) => {
    setSelectedTaskId(taskId);
    void fetchTaskStatus(taskId);
  };

  const applyIpAssignments = () => {
    if (!selectedPortIds.length || !ipPool.length) {
      return;
    }
    if (ipAssignMode === 'auto') {
      selectedPortIds.forEach((portId, index) => {
        const ip = ipPool[index % ipPool.length]?.value;
        if (ip) {
          updatePort(portId, { boundIp: ip });
        }
      });
      return;
    }
    selectedPortIds.forEach((portId) => {
      const ip = manualIpMap[portId];
      if (ip) {
        updatePort(portId, { boundIp: ip });
      }
    });
  };

  const executeTaskNow = async () => {
    try {
      setTaskNotice('');
      if (!selectedPortIds.length) {
        throw new Error('请先选择参与任务的端口');
      }
      let numbers = parsePhoneLines(phoneInput);
      if (!numbers.length && selectedDocId) {
        const doc = dataDocs.find((item) => item.id === selectedDocId);
        numbers = doc?.rows ?? [];
      }
      if (!numbers.length && libraryTakeCount > 0) {
        numbers = await takeNumbersFromLibrary(libraryTakeCount);
      }
      numbers = [...new Set(numbers)];
      if (!numbers.length) {
        throw new Error('没有可执行号码，请手填、选文本，或从号码库取号');
      }
      applyIpAssignments();
      await startBatchRun(numbers, {
        overridePortIds: selectedPortIds,
        overrideMode: 'hybrid',
        overrideHttpConcurrencyPerWorker: 8,
      });
      setTaskNotice(`任务已立即执行，号码 ${numbers.length} 条`);
      setCreateModalOpen(false);
      setPhoneInput('');
      setLibraryTakeCount(0);
      setSelectedDocId('');
      void fetchTaskList('running', 1);
      setRunningPage(1);
    } catch (error) {
      setTaskNotice(error instanceof Error ? error.message : '执行失败');
    }
  };

  const onPause = async (taskId: string) => {
    await pauseBatchRun(taskId);
    void fetchTaskList('running', runningPage);
    if (selectedTaskId) {
      void fetchTaskStatus(selectedTaskId);
    }
  };

  const onResume = async (taskId: string) => {
    await resumeBatchRun(taskId);
    void fetchTaskList('running', runningPage);
    if (selectedTaskId) {
      void fetchTaskStatus(selectedTaskId);
    }
  };

  const onStop = async (taskId: string) => {
    await stopBatchRun(taskId);
    void fetchTaskList('running', runningPage);
    if (selectedTaskId) {
      void fetchTaskStatus(selectedTaskId);
    }
  };

  return (
    <div className="page-stack task-center-shell">
      <section className="summary-grid">
        <MetricCard icon={<Activity />} label="运行中任务" value={runningTasks.length} />
        <MetricCard icon={<CheckCircle2 />} label="已完成任务" value={completedTasks.length} tone="success" />
        <MetricCard
          icon={<DatabaseZap />}
          label="当前选中任务进度"
          value={selectedTask ? `${selectedTask.processed}/${selectedTask.total}` : '-'}
        />
        <MetricCard icon={<XCircle />} label="当前选中任务失败" value={selectedTask?.failed ?? 0} tone="warning" />
      </section>

      <section className="task-board">
        <section className="panel task-panel task-panel--main">
          <div className="panel__header compact">
            <div>
              <p className="section-kicker">任务管理中心</p>
              <h2>正在执行中</h2>
            </div>
            <button className="run-button" type="button" onClick={() => setCreateModalOpen(true)}>
              新增任务
            </button>
          </div>
          <div className="task-list">
            {runningTasks.length ? (
              runningTasks.map((task) => (
                <article key={task.id} className="task-item-card">
                  <div className="task-item-card__title">
                    <button className="soft-button" type="button" onClick={() => onSelectTask(task.id)}>
                      {task.id}
                    </button>
                    <span className="status-pill status-pill--running">{task.status}</span>
                  </div>
                  <div className="task-item-card__meta">
                    <span>进度 {task.processed}/{task.total}</span>
                    <span>命中 {task.hit}</span>
                    <span>失败 {task.failed}</span>
                  </div>
                  <div className="task-item-card__actions">
                    <button className="soft-button" type="button" onClick={() => void onPause(task.id)}>
                      暂停
                    </button>
                    <button className="soft-button" type="button" onClick={() => void onResume(task.id)}>
                      继续
                    </button>
                    <button className="soft-button danger" type="button" onClick={() => void onStop(task.id)}>
                      删除/停止
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <div className="task-list-empty">暂无运行任务</div>
            )}
          </div>
          <div className="task-pagination">
            <span>运行中任务分页：第 {runningPage}/{runningTotalPages} 页</span>
            <div className="action-row">
              <button className="soft-button" type="button" onClick={() => setRunningPage((p) => Math.max(1, p - 1))}>
                上一页
              </button>
              <button className="soft-button" type="button" onClick={() => setRunningPage((p) => Math.min(runningTotalPages, p + 1))}>
                下一页
              </button>
            </div>
          </div>
        </section>

        <section className="panel task-panel task-panel--side">
          <div className="panel__header compact">
            <div>
              <p className="section-kicker">当前任务概览</p>
              <h2>{selectedTaskId || '未选择任务'}</h2>
            </div>
          </div>
          <div className="connector-note">
            {selectedTask
              ? `状态 ${selectedTask.status}，进度 ${selectedTask.processed}/${selectedTask.total}，命中 ${selectedTask.hit}，失败 ${selectedTask.failed}`
              : '点击左侧任务名称可查看该任务状态明细'}
          </div>
        </section>
      </section>

      <section className="panel task-panel">
        <div className="panel__header compact">
          <div>
            <p className="section-kicker">已完成任务</p>
            <h2>已完成任务栏</h2>
          </div>
        </div>
        <div className="task-list">
          {completedTasks.length ? (
            completedTasks.map((task) => (
              <article key={task.id} className="task-item-card task-item-card--done">
                <div className="task-item-card__title">
                  <button className="soft-button" type="button" onClick={() => onSelectTask(task.id)}>
                    {task.id}
                  </button>
                  <span className="status-pill status-pill--matched">{task.status}</span>
                </div>
                <div className="task-item-card__meta">
                  <span>进度 {task.processed}/{task.total}</span>
                  <span>命中 {task.hit}</span>
                  <span>失败 {task.failed}</span>
                </div>
              </article>
            ))
          ) : (
            <div className="task-list-empty">暂无已完成任务</div>
          )}
        </div>
        <div className="task-pagination">
          <span>已完成任务分页：第 {completedPage}/{completedTotalPages} 页</span>
          <div className="action-row">
            <button className="soft-button" type="button" onClick={() => setCompletedPage((p) => Math.max(1, p - 1))}>
              上一页
            </button>
            <button className="soft-button" type="button" onClick={() => setCompletedPage((p) => Math.min(completedTotalPages, p + 1))}>
              下一页
            </button>
          </div>
        </div>
      </section>

      {createModalOpen ? (
        <div className="tutorial-overlay" role="presentation" onClick={() => setCreateModalOpen(false)}>
          <div className="tutorial-modal task-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="panel__header compact">
              <div>
                <p className="section-kicker">新增任务</p>
                <h2>任务设置</h2>
              </div>
            </div>
            <div className="runtime-config-form">
              <select value={selectedDocId} onChange={(event) => setSelectedDocId(event.target.value)}>
                <option value="">选择文本（可选）</option>
                {dataDocs.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.name}（{doc.rows.length}）
                  </option>
                ))}
              </select>
            </div>
            <div className="connector-note">选择参与任务的端口</div>
            <div className="action-row">
              <button className="soft-button" type="button" onClick={() => setSelectedPortIds(ports.map((port) => port.id))}>
                全选
              </button>
              <button className="soft-button" type="button" onClick={() => setSelectedPortIds([])}>
                全部取消
              </button>
            </div>
            <div className="flow-grid">
              {ports.map((port) => {
                const checked = selectedPortIds.includes(port.id);
                return (
                  <button
                    key={`task-port-${port.id}`}
                    className={checked ? 'flow-chip active' : 'flow-chip'}
                    type="button"
                    onClick={() =>
                      setSelectedPortIds((current) =>
                        current.includes(port.id) ? current.filter((id) => id !== port.id) : [...current, port.id],
                      )
                    }
                  >
                    {port.name}
                  </button>
                );
              })}
            </div>
            <div className="connector-note">IP分配</div>
            <div className="runtime-config-form">
              <select value={ipAssignMode} onChange={(event) => setIpAssignMode(event.target.value as 'auto' | 'manual')}>
                <option value="auto">自动分配</option>
                <option value="manual">手动分配</option>
              </select>
            </div>
            {ipAssignMode === 'manual' ? (
              <div className="runtime-config-form">
                {selectedPortIds.map((portId) => (
                  <select
                    key={`manual-ip-${portId}`}
                    value={manualIpMap[portId] ?? ''}
                    onChange={(event) => setManualIpMap((current) => ({ ...current, [portId]: event.target.value }))}
                  >
                    <option value="">{portId} 选择IP</option>
                    {ipPool.map((ip) => (
                      <option key={`${portId}-${ip.value}`} value={ip.value}>
                        {ip.value}
                      </option>
                    ))}
                  </select>
                ))}
              </div>
            ) : null}
            <div className="connector-note">选择要筛选的号码（手填或从号码库提取）</div>
            <textarea
              className="batch-input"
              value={phoneInput}
              onChange={(event) => setPhoneInput(event.target.value)}
              placeholder="手动填写号码，一行一个"
            />
            <div className="runtime-config-form">
              <input
                type="number"
                min={0}
                value={libraryTakeCount}
                onChange={(event) => setLibraryTakeCount(Math.max(0, Number(event.target.value) || 0))}
                placeholder="从号码库按顺序取号数量"
              />
            </div>
            <div className="action-row">
              <button className="run-button" type="button" onClick={() => void executeTaskNow()}>
                立即执行
              </button>
              <button className="soft-button" type="button" onClick={() => setCreateModalOpen(false)}>
                取消
              </button>
            </div>
            {taskNotice ? <div className="connector-note">{taskNotice}</div> : null}
          </div>
        </div>
      ) : null}
      {taskNotice && !createModalOpen ? <div className="connector-note">{taskNotice}</div> : null}
    </div>
  );
}

function RunnerPage({
  batchId,
  batchRows,
  batchRunning,
  batchStatus,
  dataDocs,
  dedupeLibrary,
  distributionPlan,
  exportBatchRows,
  onlinePorts,
  planSummary,
  selfCheckSummary,
  portProgress,
  portRuntimeRows,
  ipReserveRows,
  ports,
  runnerDocId,
  runnerInput,
  runnerNotice,
  runtimeBaseUrl,
  selectedPortIds,
  batchMode,
  httpConcurrencyPerWorker,
  setBatchMode,
  setHttpConcurrencyPerWorker,
  setManualPortSelection,
  setRuntimeBaseUrl,
  setRunnerDocId,
  setRunnerInput,
  setSelectedPortIds,
  startBatchRun,
  pauseBatchRun,
  resumeBatchRun,
  stopBatchRun,
  setPortPaused,
  stats,
}: {
  batchId: string;
  batchRows: BatchRow[];
  batchRunning: boolean;
  batchStatus: BatchStatus | null;
  dataDocs: DataDocument[];
  dedupeLibrary: string[];
  distributionPlan: Record<string, number>;
  exportBatchRows: () => Promise<void>;
  onlinePorts: number;
  planSummary: { raw: number; unique: number; unscreened: number } | null;
  selfCheckSummary: string;
  portProgress: Record<string, PortProgress>;
  portRuntimeRows: PortRuntimeRow[];
  ipReserveRows: IpReserveRow[];
  ports: EmulatorPort[];
  runnerDocId: string;
  runnerInput: string;
  runnerNotice: string;
  runtimeBaseUrl: string;
  selectedPortIds: string[];
  batchMode: 'direct' | 'hybrid' | 'browser';
  httpConcurrencyPerWorker: number;
  setBatchMode: (value: 'direct' | 'hybrid' | 'browser') => void;
  setHttpConcurrencyPerWorker: (value: number) => void;
  setManualPortSelection: (value: boolean) => void;
  setRuntimeBaseUrl: (value: string) => void;
  setRunnerDocId: (value: string) => void;
  setRunnerInput: (value: string) => void;
  setSelectedPortIds: (value: string[]) => void;
  startBatchRun: (
    incomingPhones: string[],
    options?: { dedicatedAssignments?: Record<string, string>; squads?: Array<{ id: string; portIds: string[]; phones: string[] }> },
  ) => Promise<void>;
  pauseBatchRun: (targetBatchId?: string) => Promise<void>;
  resumeBatchRun: (targetBatchId?: string) => Promise<void>;
  stopBatchRun: (targetBatchId?: string) => Promise<void>;
  setPortPaused: (portId: string, paused: boolean) => Promise<void>;
  stats: SearchStats;
}) {
  const [runtimeInput, setRuntimeInput] = useState(runtimeBaseUrl || window.location.origin);
  const [dedicatedTaskText, setDedicatedTaskText] = useState('');
  const [squadTaskText, setSquadTaskText] = useState('');
  const selectedDoc = dataDocs.find((doc) => doc.id === runnerDocId);
  const draftPhones = selectedDoc ? selectedDoc.rows : parsePhoneLines(runnerInput);
  const uniquePhones = [...new Set(draftPhones)];
  const unscreenedPhones = uniquePhones.filter((phone) => !dedupeLibrary.includes(phone));
  const progressPercent = batchStatus?.total ? Math.round((batchStatus.processed / batchStatus.total) * 100) : 0;
  const directCount = batchStatus?.directCount ?? 0;
  const fallbackCount = batchStatus?.fallbackCount ?? 0;
  const directRatio = batchStatus?.processed ? Math.round((directCount / Math.max(1, batchStatus.processed)) * 100) : 0;
  const fallbackRatio = batchStatus?.processed ? Math.round((fallbackCount / Math.max(1, batchStatus.processed)) * 100) : 0;
  const runtimePortMap = new Map(portRuntimeRows.map((row) => [row.portId, row]));
  const latestRecord = (batchStatus?.records?.[batchStatus.records.length - 1] as BatchRecord | undefined) ?? undefined;
  const mergedOutputText = (batchStatus?.records ?? [])
    .map((row) => (row.opened && row.qq ? `${row.phone}：${row.qq}` : `${row.phone}：无结果`))
    .join('\n');

  const parseDedicatedAssignments = () => {
    const map: Record<string, string> = {};
    dedicatedTaskText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const [phone, portId] = line.split(/[,\s:]+/).map((item) => item.trim());
        if (phone && portId) {
          map[phone] = portId;
        }
      });
    return map;
  };

  const parseSquads = () => {
    const rows = squadTaskText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return rows
      .map((line, index) => {
        const [id, portIdsRaw, phonesRaw] = line.split('|').map((item) => item.trim());
        if (!id || !portIdsRaw || !phonesRaw) {
          return null;
        }
        return {
          id: id || `squad-${index + 1}`,
          portIds: portIdsRaw.split(',').map((item) => item.trim()).filter(Boolean),
          phones: phonesRaw.split(',').map((item) => item.trim()).filter(Boolean),
        };
      })
      .filter(Boolean) as Array<{ id: string; portIds: string[]; phones: string[] }>;
  };

  useEffect(() => {
    setRuntimeInput(runtimeBaseUrl || window.location.origin);
  }, [runtimeBaseUrl]);

  const saveRuntimeBase = () => {
    const normalized = normalizeRuntimeBase(runtimeInput);
    const nextValue = normalized || window.location.origin;
    window.localStorage.setItem('qe-runtime-base', nextValue);
    setRuntimeBaseUrl(nextValue);
  };

  return (
    <div className="page-stack">
      <section className="summary-grid">
        <MetricCard icon={<Monitor />} label="端口总数" value={ports.length} />
        <MetricCard icon={<CheckCircle2 />} label="在线端口" value={onlinePorts} tone="success" />
        <MetricCard icon={<Activity />} label="待处理" value={stats.pending} />
        <MetricCard icon={<XCircle />} label="失败任务" value={stats.failed} tone="warning" />
      </section>

      <section className="panel">
        <div className="panel__header compact">
          <div>
            <p className="section-kicker">任务管理</p>
            <h2>部署检查与分配策略</h2>
          </div>
          <Bot className="panel-icon" />
        </div>
        <div className="runtime-form">
          <input
            value={runtimeInput}
            onChange={(event) => setRuntimeInput(event.target.value)}
            placeholder="http://127.0.0.1:8794"
          />
          <button className="soft-button" type="button" onClick={saveRuntimeBase}>
            保存Runner地址
          </button>
        </div>
        <div className="runtime-config-form">
          <select value={batchMode} onChange={(event) => setBatchMode(event.target.value as 'direct' | 'hybrid' | 'browser')}>
            <option value="hybrid">混合（直连优先 + 浏览器回退）</option>
            <option value="direct">直连HTTP</option>
            <option value="browser">纯浏览器</option>
          </select>
          <input
            type="number"
            min={1}
            value={httpConcurrencyPerWorker}
            onChange={(event) => setHttpConcurrencyPerWorker(Math.max(1, Number(event.target.value) || 1))}
            placeholder="每端口HTTP并发"
          />
          <select value={runnerDocId} onChange={(event) => setRunnerDocId(event.target.value)}>
            <option value="">使用手动输入数据</option>
            {dataDocs.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.name}（{doc.rows.length}）
              </option>
            ))}
          </select>
          <textarea
            className="batch-input"
            value={runnerInput}
            onChange={(event) => setRunnerInput(event.target.value)}
            placeholder="手动输入待筛选号码（每行一个）"
            disabled={Boolean(selectedDoc)}
          />
        </div>
        <div className="connector-note">
          计划数据：原始 {draftPhones.length} 条，去重后 {uniquePhones.length} 条，二次去重后待筛选 {unscreenedPhones.length} 条。
          {planSummary ? ` 最近启动：原始 ${planSummary.raw} / 去重 ${planSummary.unique} / 待筛选 ${planSummary.unscreened}` : ''}
        </div>
        <div className="runtime-config-form">
          <textarea
            className="batch-input"
            value={dedicatedTaskText}
            onChange={(event) => setDedicatedTaskText(event.target.value)}
            placeholder="独立任务分配（每行: 手机号,端口ID）例如: 13800138000,port-1"
          />
          <textarea
            className="batch-input"
            value={squadTaskText}
            onChange={(event) => setSquadTaskText(event.target.value)}
            placeholder="端口小队任务（每行: 小队ID|端口ID列表|手机号列表）例如: team-a|port-1,port-2|138001,138002"
          />
        </div>
        <div className="connector-note">当前待发数据窗口：{unscreenedPhones.length} 条（来自数据整理去重后的结果）</div>
        <textarea className="batch-input" value={unscreenedPhones.join('\n')} readOnly placeholder="待发数据会显示在这里" />
        <div className="connector-note">
          预备中的端口：{ports.filter((port) => port.status !== 'offline').length} 个；预备中的IP：{ports.filter((port) => port.boundIp).length} 个已绑定。
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>预备IP</th>
                <th>状态</th>
                <th>评分</th>
                <th>延迟(ms)</th>
              </tr>
            </thead>
            <tbody>
              {ipReserveRows.length ? (
                ipReserveRows.slice(0, 20).map((row) => (
                  <tr key={`ip-reserve-${row.proxy}`}>
                    <td>{row.proxy}</td>
                    <td>{row.state}</td>
                    <td>{row.score}</td>
                    <td>{row.latency_ms ?? '-'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="empty-cell">
                    暂无预备IP状态
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flow-grid">
          {ports.map((port, index) => (
            <button
              className="flow-card"
              key={port.id}
              type="button"
              onClick={() =>
                {
                  setManualPortSelection(true);
                  setSelectedPortIds(
                    selectedPortIds.includes(port.id)
                      ? selectedPortIds.filter((id) => id !== port.id)
                      : [...selectedPortIds, port.id],
                  );
                }
              }
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>
                {port.name} {selectedPortIds.includes(port.id) ? '（已选）' : ''}
              </strong>
              <small>
                分配 {distributionPlan[port.id] ?? 0} 条；进度 {portProgress[port.id]?.processed ?? 0}/
                {portProgress[port.id]?.assigned ?? 0}
              </small>
            </button>
          ))}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>端口</th>
                <th>状态</th>
                <th>在途任务</th>
                <th>控制</th>
              </tr>
            </thead>
            <tbody>
              {ports.map((port) => {
                const runtime = runtimePortMap.get(port.id);
                const paused = runtime?.paused ?? false;
                return (
                  <tr key={`runtime-${port.id}`}>
                    <td>{port.name}</td>
                    <td>{runtime?.status ?? 'ready'}</td>
                    <td>{runtime?.inflight ?? 0}</td>
                    <td className="action-row">
                      <button className="soft-button" type="button" onClick={() => void setPortPaused(port.id, !paused)}>
                        {paused ? '继续端口' : '停止端口'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel settings-panel">
        <div className="panel__header compact">
          <div>
            <p className="section-kicker">批量任务</p>
            <h2>自动批处理</h2>
          </div>
          <Bot className="panel-icon" />
        </div>
        <div className="runtime-config-form">
          <button
            className="run-button"
            type="button"
            onClick={() =>
              void startBatchRun(unscreenedPhones, {
                dedicatedAssignments: parseDedicatedAssignments(),
                squads: parseSquads(),
              })
            }
            disabled={batchRunning}
          >
            {batchRunning ? '任务执行中' : '开始分配并执行'}
          </button>
          <button
            className="soft-button"
            type="button"
            onClick={() => void pauseBatchRun()}
            disabled={!batchRunning || batchStatus?.status === 'paused'}
          >
            集体暂停
          </button>
          <button
            className="soft-button"
            type="button"
            onClick={() => void resumeBatchRun()}
            disabled={!batchRunning || batchStatus?.status !== 'paused'}
          >
            集体继续
          </button>
          <button className="soft-button danger" type="button" onClick={() => void stopBatchRun()} disabled={!batchRunning}>
            集体停止
          </button>
          <button className="soft-button" type="button" onClick={() => void exportBatchRows()} disabled={!batchId}>
            导出命中结果
          </button>
        </div>
        {selfCheckSummary ? <div className="connector-note">{selfCheckSummary}</div> : null}
        <div className="step-grid">
          <div className="flow-card">
            <span>01</span>
            <strong>数据准备</strong>
            <small>{draftPhones.length} 条</small>
          </div>
          <div className="flow-card">
            <span>02</span>
            <strong>二次去重</strong>
            <small>待筛选 {unscreenedPhones.length} 条</small>
          </div>
          <div className="flow-card">
            <span>03</span>
            <strong>端口分配</strong>
            <small>{Object.values(distributionPlan).reduce((a, b) => a + b, 0)} 条已分配</small>
          </div>
          <div className="flow-card">
            <span>04</span>
            <strong>检测执行</strong>
            <small>{batchStatus ? `${batchStatus.processed}/${batchStatus.total}` : '未开始'}</small>
          </div>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>
        <div className="connector-note">
          最终检测进度：{progressPercent}% 。当前批次：{batchId || '未启动'}。
          {batchStatus
            ? ` 进度 ${batchStatus.processed}/${batchStatus.total}，命中 ${batchStatus.hit}，失败 ${batchStatus.failed}。直连 ${directCount}（${directRatio}%），回退 ${fallbackCount}（${fallbackRatio}%）。`
            : ''}
        </div>
        {latestRecord ? (
          <div className="connector-note">
            当前识别：{latestRecord.opened && latestRecord.qq ? `${latestRecord.phone}：${latestRecord.qq}` : `${latestRecord.phone}：无结果`}
          </div>
        ) : null}
        {runnerNotice ? <div className="connector-note">{runnerNotice}</div> : null}
        <div className="connector-note">汇总文本输出（所有窗口结果合并到同一文本）</div>
        <textarea className="batch-input" value={mergedOutputText} readOnly placeholder="筛选后会在这里统一输出：手机号：QQ号 / 手机号：无结果" />
        {batchRows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>手机号</th>
                  <th>QQ号</th>
                  <th>查询时间</th>
                  <th>重试次数</th>
                </tr>
              </thead>
              <tbody>
                {batchRows.slice(0, 50).map((row) => (
                  <tr key={`${row.phone}-${row.query_time}`}>
                    <td>{row.phone}</td>
                    <td>{row.qq}</td>
                    <td>{row.query_time}</td>
                    <td>{row.retry_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function SecurityPage({
  isSuperAdmin,
  subAccounts,
  auditRows,
  newSubUsername,
  newSubPassword,
  setNewSubUsername,
  setNewSubPassword,
  createSubAccount,
  setSubAccountStatus,
}: {
  isSuperAdmin: boolean;
  subAccounts: AuthUser[];
  auditRows: AuditLogRow[];
  newSubUsername: string;
  newSubPassword: string;
  setNewSubUsername: (value: string) => void;
  setNewSubPassword: (value: string) => void;
  createSubAccount: () => Promise<void>;
  setSubAccountStatus: (username: string, status: 'active' | 'disabled') => Promise<void>;
}) {
  if (!isSuperAdmin) {
    return (
      <div className="page-stack">
        <section className="panel settings-panel">
          <div className="connector-note">当前账号无子账号管理权限。</div>
        </section>
      </div>
    );
  }
  return (
    <div className="page-stack">
      <section className="panel settings-panel">
        <div className="panel__header compact">
          <div>
            <p className="section-kicker">子账号管理</p>
            <h2>创建与权限控制</h2>
          </div>
        </div>
        <div className="runtime-config-form">
          <input value={newSubUsername} onChange={(event) => setNewSubUsername(event.target.value)} placeholder="子账号用户名" />
          <input
            type="password"
            value={newSubPassword}
            onChange={(event) => setNewSubPassword(event.target.value)}
            placeholder="子账号初始密码"
          />
          <button className="run-button" type="button" onClick={() => void createSubAccount()}>
            新增子账号
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>账号</th>
                <th>角色</th>
                <th>状态</th>
                <th>最近登录</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {subAccounts.map((user) => (
                <tr key={`user-${user.userId}`}>
                  <td>{user.username}</td>
                  <td>{user.role}</td>
                  <td>{user.status ?? 'active'}</td>
                  <td>{user.lastLoginAt || '-'}</td>
                  <td className="action-row">
                    <button className="soft-button" type="button" onClick={() => void setSubAccountStatus(user.username, 'active')}>
                      启用
                    </button>
                    <button className="soft-button danger" type="button" onClick={() => void setSubAccountStatus(user.username, 'disabled')}>
                      禁用
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel settings-panel">
        <div className="panel__header compact">
          <div>
            <p className="section-kicker">全量审计日志</p>
            <h2>账号与操作追踪</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>动作</th>
                <th>账号</th>
                <th>对象</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {auditRows.length ? (
                auditRows.slice(0, 500).map((row, index) => (
                  <tr key={`audit-${index}`}>
                    <td>{row.at}</td>
                    <td>{row.type}</td>
                    <td>{row.username ?? row.actor ?? '-'}</td>
                    <td>{row.target ?? row.batchId ?? '-'}</td>
                    <td>{row.status ?? row.reason ?? '-'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="empty-cell">
                    暂无审计记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ResultTable({ resultRows }: { resultRows: QueryItem[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>原始数据</th>
            <th>分类</th>
            <th>置信度</th>
            <th>结果摘要</th>
            <th>标签</th>
          </tr>
        </thead>
        <tbody>
          {resultRows.length === 0 ? (
            <tr>
              <td colSpan={5} className="empty-cell">
                等待搜索返回结果
              </td>
            </tr>
          ) : (
            resultRows.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.raw}</strong>
                  <small>{item.normalized}</small>
                </td>
                <td>
                  {item.result ? (
                    <span className={`category category--${categoryTone[item.result.category]}`}>
                      {item.result.category}
                    </span>
                  ) : (
                    <span className="category category--muted">无结果</span>
                  )}
                </td>
                <td>{item.result ? `${item.result.confidence}%` : '-'}</td>
                <td>{item.result?.summary ?? item.error ?? '未返回可整理结果'}</td>
                <td>
                  <div className="tag-row">
                    {(item.result?.tags ?? ['未开通']).map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number | string;
  tone?: 'success' | 'warning';
}) {
  return (
    <div className={`metric-card ${tone ? `metric-card--${tone}` : ''}`}>
      <div>{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusPill({ status, active }: { status: QueryStatus; active: boolean }) {
  const label: Record<QueryStatus, string> = {
    pending: '待处理',
    running: '搜索中',
    matched: '已匹配',
    empty: '无结果',
    failed: '失败',
  };

  return <span className={`status-pill status-pill--${status} ${active ? 'status-pill--active' : ''}`}>{label[status]}</span>;
}

function EmptyState() {
  return (
    <div className="empty-state">
      <UploadCloud size={30} />
      <strong>上传 TXT 或手动输入数据</strong>
      <span>每行会生成一条待搜索任务，由 Runner 平均分发到多个 QQ 端口。</span>
    </div>
  );
}

export default App;
