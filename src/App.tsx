import {
  Activity,
  Bot,
  CheckCircle2,
  Copy,
  DatabaseZap,
  Download,
  FileText,
  Gauge,
  HardDriveDownload,
  LayoutDashboard,
  Monitor,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { type ChangeEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import './styles.css';

type PageKey = 'dashboard' | 'data' | 'accounts' | 'runner' | 'settings';
type QueryStatus = 'pending' | 'running' | 'matched' | 'empty' | 'failed';
type PortStatus = 'ready' | 'booting' | 'offline';
type AccountStatus = 'normal' | 'abnormal';

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
  category: '高价值' | '待复核' | '无效线索';
  source: string;
  confidence: number;
  summary: string;
  tags: string[];
};

type SearchStats = {
  total: number;
  matched: number;
  empty: number;
  failed: number;
  pending: number;
};

type EmulatorPort = {
  id: string;
  name: string;
  port: number;
  status: PortStatus;
  accountStatus: AccountStatus;
  qqInstalled: boolean;
  account?: string;
  source: 'base-download' | 'cloned';
};

const categoryTone: Record<SearchResult['category'], string> = {
  高价值: 'success',
  待复核: 'warning',
  无效线索: 'muted',
};

const demoLines = ['QQ: 19888990001', 'wxid_alpha_2949', '13800138000', 'market-data-node', 'unknown-empty-case'];
const demoMode = import.meta.env.VITE_QE_DEMO_MODE === 'true';
const searchEndpoint = (import.meta.env.VITE_QE_SEARCH_ENDPOINT as string | undefined) || '/api/search';
const portLoginEndpoint = (import.meta.env.VITE_QE_PORT_LOGIN_ENDPOINT as string | undefined) || '/api/ports/login';

const initialPorts: EmulatorPort[] = [
  {
    id: 'port-1',
    name: 'QQ端口 01',
    port: 8787,
    status: 'ready',
    accountStatus: 'abnormal',
    qqInstalled: true,
    account: '未登录',
    source: 'base-download',
  },
];

const navItems: Array<{ key: PageKey; label: string; desc: string; icon: ReactNode }> = [
  { key: 'dashboard', label: '控制台', desc: '运行总览', icon: <LayoutDashboard size={17} /> },
  { key: 'data', label: '数据整理', desc: 'TXT 搜索任务', icon: <Search size={17} /> },
  { key: 'accounts', label: '账号管理', desc: '端口/模拟器', icon: <Monitor size={17} /> },
  { key: 'runner', label: '任务管理', desc: '并发分发', icon: <Bot size={17} /> },
  { key: 'settings', label: 'API 配置', desc: '接口与部署', icon: <Settings size={17} /> },
];

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

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

const createMockResult = async (query: string): Promise<SearchResult | null> => {
  await delay(360 + Math.random() * 540);

  if (/empty|unknown|无结果/i.test(query)) {
    return null;
  }

  const scoreSeed = Array.from(query).reduce((total, char) => total + char.charCodeAt(0), 0);
  const confidence = 62 + (scoreSeed % 35);
  const category: SearchResult['category'] =
    confidence >= 86 ? '高价值' : confidence >= 72 ? '待复核' : '无效线索';

  return {
    title: `匹配档案 ${query.slice(0, 18)}`,
    category,
    source: 'QE模拟引擎',
    confidence,
    summary: `已根据输入 "${query}" 生成标准化线索；真实运行时由托管 QQ Runtime 分发到各端口校验。`,
    tags: [query.includes('@') ? '邮箱' : '文本', /\d{6,}/.test(query) ? '数字账号' : '关键词', '自动整理'],
  };
};

const normalizeCategory = (category?: string): SearchResult['category'] => {
  if (category === '高价值' || category === '待复核' || category === '无效线索') {
    return category;
  }

  return '待复核';
};

const loginPortAccount = async (port: EmulatorPort, account: string, password: string) => {
  if (demoMode) {
    await delay(480);
    return {
      account,
      message: '演示模式已模拟完成端口登录。',
    };
  }

  const response = await fetch(portLoginEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      account,
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

const searchQuery = async (query: string): Promise<SearchResult | null> => {
  if (demoMode) {
    return createMockResult(query);
  }

  const response = await fetch(searchEndpoint, {
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
    title?: string;
    category?: string;
    summary?: string;
    score?: number;
    confidence?: number;
    source?: string;
    tags?: string[];
  };

  if (data.success === false) {
    return null;
  }

  return {
    title: data.title ?? `QQ 搜索返回 ${query.slice(0, 18)}`,
    category: normalizeCategory(data.category),
    source: data.source ?? 'QQ搜索框',
    confidence: Math.max(0, Math.min(100, Math.round(data.confidence ?? data.score ?? 72))),
    summary: data.summary ?? '接口已返回结果，请在托管 QQ Runtime 中补充摘要字段以提升整理质量。',
    tags: data.tags?.length ? data.tags : ['QQ搜索', '接口返回'],
  };
};

const toCsv = (items: QueryItem[]) => {
  const headers = ['原始数据', '标准化数据', '状态', '分类', '置信度', '结果标题', '摘要', '标签'];
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
  const [activePage, setActivePage] = useState<PageKey>('dashboard');
  const [items, setItems] = useState<QueryItem[]>([]);
  const [manualValue, setManualValue] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [ports, setPorts] = useState<EmulatorPort[]>(initialPorts);
  const [selectedPortId, setSelectedPortId] = useState<string | undefined>(initialPorts[0]?.id);
  const stopRequested = useRef(false);

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
  const onlinePorts = ports.filter((port) => port.status === 'ready').length;
  const nextPortNumber = ports.length ? Math.max(...ports.map((port) => port.port)) + 1 : 8787;

  const replaceItems = (nextItems: QueryItem[]) => {
    stopRequested.current = false;
    setItems(nextItems);
    setActiveIndex(null);
  };

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const text = await file.text();
    replaceItems(parseTxtRows(text));
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

  const loadDemoData = () => {
    replaceItems(parseTxtRows(demoLines.join('\n')));
    setActivePage('data');
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
        const result = await searchQuery(item.normalized);
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
      status: 'booting',
      accountStatus: 'abnormal',
      qqInstalled: true,
      account: '未登录',
      source: isFirstPort ? 'base-download' : 'cloned',
    };

    setPorts((current) => [...current, port]);
    setSelectedPortId(port.id);
    window.setTimeout(() => {
      setPorts((current) =>
        current.map((currentPort) => (currentPort.id === port.id ? { ...currentPort, status: 'ready' } : currentPort)),
      );
    }, 720);
  };

  const clonePort = (sourcePort: EmulatorPort) => {
    const port: EmulatorPort = {
      id: `port-${Date.now()}`,
      name: `QQ端口 ${String(ports.length + 1).padStart(2, '0')}`,
      port: nextPortNumber,
      status: 'booting',
      accountStatus: 'abnormal',
      qqInstalled: sourcePort.qqInstalled,
      account: '未登录',
      source: 'cloned',
    };

    setPorts((current) => [...current, port]);
    setSelectedPortId(port.id);
    window.setTimeout(() => {
      setPorts((current) =>
        current.map((currentPort) => (currentPort.id === port.id ? { ...currentPort, status: 'ready' } : currentPort)),
      );
    }, 520);
  };

  const deletePort = (id: string) => {
    setPorts((current) => current.filter((port) => port.id !== id));
    setSelectedPortId((current) => (current === id ? ports.find((port) => port.id !== id)?.id : current));
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
            activeIndex={activeIndex}
            exportResults={exportResults}
            handleFileUpload={handleFileUpload}
            isRunning={isRunning}
            items={items}
            loadDemoData={loadDemoData}
            manualValue={manualValue}
            resultRows={resultRows}
            runSearch={runSearch}
            setManualValue={setManualValue}
            addManualQuery={addManualQuery}
            resetWorkspace={resetWorkspace}
            stopSearch={stopSearch}
          />
        );
      case 'accounts':
        return (
          <AccountPage
            addPort={addPort}
            clonePort={clonePort}
            deletePort={deletePort}
            initializePort={initializePort}
            ports={ports}
            selectedPortId={selectedPortId}
            selectPort={setSelectedPortId}
            markPortLoggedIn={markPortLoggedIn}
          />
        );
      case 'runner':
        return <RunnerPage onlinePorts={onlinePorts} ports={ports} stats={stats} />;
      case 'settings':
        return <SettingsPage />;
      default:
        return (
          <DashboardPage
            completionRate={completionRate}
            handleFileUpload={handleFileUpload}
            loadDemoData={loadDemoData}
            onlinePorts={onlinePorts}
            ports={ports}
            setActivePage={setActivePage}
            stats={stats}
          />
        );
    }
  };

  return (
    <main className="console-shell">
      <aside className="sidebar">
        <div className="brand-card">
          <div className="brand-logo">QE</div>
          <div>
            <strong>QE 控制台</strong>
            <span>QQ Runner System</span>
          </div>
        </div>

        <nav className="main-nav">
          {navItems.map((item) => (
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
            <small>Runner: /api/search</small>
          </div>
        </div>
      </aside>

      <section className="content-shell">
        <header className="topbar">
          <div>
            <span className="section-kicker">QE Intelligence Console</span>
            <h1>{navItems.find((item) => item.key === activePage)?.label}</h1>
          </div>
          <button className="refresh-button" onClick={loadDemoData} type="button">
            <RotateCcw size={16} />
            载入演示
          </button>
        </header>

        {renderPage()}
      </section>
    </main>
  );
}

function DashboardPage({
  completionRate,
  handleFileUpload,
  loadDemoData,
  onlinePorts,
  ports,
  setActivePage,
  stats,
}: {
  completionRate: number;
  handleFileUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  loadDemoData: () => void;
  onlinePorts: number;
  ports: EmulatorPort[];
  setActivePage: (page: PageKey) => void;
  stats: SearchStats;
}) {
  return (
    <div className="page-stack">
      <section className="summary-grid">
        <MetricCard icon={<FileText />} label="总数据" value={stats.total} />
        <MetricCard icon={<CheckCircle2 />} label="有结果" value={stats.matched} tone="success" />
        <MetricCard icon={<Monitor />} label="在线端口" value={onlinePorts} tone="success" />
        <MetricCard icon={<Gauge />} label="整理进度" value={`${completionRate}%`} />
      </section>

      <section className="compact-grid">
        <div className="panel intro-panel">
          <div className="panel__header compact">
            <div>
              <p className="section-kicker">快速开始</p>
              <h2>上传 TXT 后交给 QQ Runner 分发</h2>
            </div>
            <DatabaseZap className="panel-icon" />
          </div>
          <p className="muted-copy">
            右侧每个功能独立成页。数据整理页负责上传和搜索；账号管理页负责生成端口，每个端口代表一个 QQ
            模拟器实例。
          </p>
          <div className="action-row">
            <label className="primary-upload">
              <UploadCloud size={18} />
              上传 TXT
              <input type="file" accept=".txt,text/plain" onChange={handleFileUpload} />
            </label>
            <button className="ghost-button" onClick={loadDemoData} type="button">
              载入演示数据
            </button>
            <button className="ghost-button" onClick={() => setActivePage('accounts')} type="button">
              管理端口
            </button>
          </div>
        </div>

        <div className="panel mini-panel">
          <div className="panel__header compact">
            <div>
              <p className="section-kicker">端口概览</p>
              <h2>{ports.length} 个模拟器端口</h2>
            </div>
            <ShieldCheck className="panel-icon" />
          </div>
          <div className="port-mini-list">
            {ports.map((port) => (
              <div key={port.id}>
                <span>{port.name}</span>
                <strong>{port.account}</strong>
                <small>{port.port}</small>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function DataPage({
  activeIndex,
  addManualQuery,
  exportResults,
  handleFileUpload,
  isRunning,
  items,
  loadDemoData,
  manualValue,
  resetWorkspace,
  resultRows,
  runSearch,
  setManualValue,
  stopSearch,
}: {
  activeIndex: number | null;
  addManualQuery: () => void;
  exportResults: () => void;
  handleFileUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  isRunning: boolean;
  items: QueryItem[];
  loadDemoData: () => void;
  manualValue: string;
  resetWorkspace: () => void;
  resultRows: QueryItem[];
  runSearch: () => void;
  setManualValue: (value: string) => void;
  stopSearch: () => void;
}) {
  return (
    <section className="workbench-grid">
      <div className="panel intake-panel">
        <div className="panel__header compact">
          <div>
            <p className="section-kicker">01 / 数据整理区域</p>
            <h2>输入队列</h2>
          </div>
          <label className="icon-upload">
            <UploadCloud size={17} />
            <input type="file" accept=".txt,text/plain" onChange={handleFileUpload} />
          </label>
        </div>

        <div className="manual-entry">
          <Search size={16} />
          <input
            value={manualValue}
            onChange={(event) => setManualValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                addManualQuery();
              }
            }}
            placeholder="输入数据，回车加入队列"
          />
          <button type="button" onClick={addManualQuery}>
            加入
          </button>
        </div>

        <div className="control-row">
          <button type="button" className="run-button" onClick={runSearch} disabled={isRunning || !items.length}>
            {isRunning ? <Activity size={16} /> : <Play size={16} />}
            {isRunning ? '运行中' : '开始'}
          </button>
          <button type="button" className="soft-button" onClick={stopSearch} disabled={!isRunning}>
            <Pause size={16} />
            暂停
          </button>
          <button type="button" className="soft-button" onClick={resetWorkspace}>
            <RotateCcw size={16} />
            重置
          </button>
          <button type="button" className="soft-button" onClick={loadDemoData}>
            演示
          </button>
        </div>

        <div className="queue-list compact-list">
          {items.length === 0 ? (
            <EmptyState />
          ) : (
            items.map((item, index) => (
              <div className={`queue-item queue-item--${item.status}`} key={item.id}>
                <span className="queue-item__index">{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <strong>{item.raw}</strong>
                  <small>{item.normalized}</small>
                </div>
                <StatusPill status={item.status} active={activeIndex === index} />
              </div>
            ))
          )}
        </div>
      </div>

      <div className="panel result-panel">
        <div className="panel__header compact">
          <div>
            <p className="section-kicker">02 / 结果表格</p>
            <h2>搜索返回与分类</h2>
          </div>
          <button type="button" className="export-button" onClick={exportResults} disabled={!items.length}>
            <Download size={16} />
            导出 CSV
          </button>
        </div>

        <div className="connector-note">
          默认调用 /api/search；Vercel 转发到托管 QQ Runtime，实现多端口并发校验。
        </div>

        <ResultTable resultRows={resultRows} />
      </div>
    </section>
  );
}

function AccountPage({
  addPort,
  clonePort,
  deletePort,
  initializePort,
  ports,
  selectedPortId,
  selectPort,
  markPortLoggedIn,
}: {
  addPort: () => void;
  clonePort: (port: EmulatorPort) => void;
  deletePort: (id: string) => void;
  initializePort: (id: string) => void;
  ports: EmulatorPort[];
  selectedPortId?: string;
  selectPort: (id: string) => void;
  markPortLoggedIn: (id: string, account: string) => void;
}) {
  const activePort = ports.find((port) => port.id === selectedPortId) ?? ports[0];
  const [loginAccount, setLoginAccount] = useState(activePort?.accountStatus === 'normal' ? activePort.account ?? '' : '');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginMessage, setLoginMessage] = useState('');

  useEffect(() => {
    setLoginAccount(activePort?.accountStatus === 'normal' ? activePort.account ?? '' : '');
    setLoginPassword('');
    setLoginMessage('');
  }, [activePort?.account, activePort?.accountStatus, activePort?.id]);

  const handlePortLogin = async () => {
    if (!activePort) {
      return;
    }

    const nextAccount = loginAccount.trim();
    if (!nextAccount || !loginPassword.trim()) {
      setLoginMessage('请输入 QQ 账号和密码后再登录。');
      return;
    }

    setLoginMessage('正在请求托管 QQ Runtime 自动登录...');

    try {
      const result = await loginPortAccount(activePort, nextAccount, loginPassword);
      markPortLoggedIn(activePort.id, result.account);
      setLoginMessage(result.message);
    } catch (error) {
      setLoginMessage(error instanceof Error ? error.message : '托管 QQ Runtime 登录失败。');
    }
  };

  return (
    <div className="account-layout">
      <section className="account-toolbar account-toolbar--minimal">
        <div className="account-actions">
          <button className="run-button" onClick={addPort} type="button">
            <Plus size={17} />
            生成端口
          </button>
          {activePort ? (
            <button className="soft-button" onClick={() => clonePort(activePort)} type="button">
              <Copy size={16} />
              复制当前端口
            </button>
          ) : null}
        </div>
      </section>

      {activePort ? (
        <section className="qq-expanded">
          <div className="qq-expanded__device">
            <div className="qq-portrait-shell">
              <div className="qq-app-window">
                <div className="qq-app-header">
                  <span className={`account-light account-light--${activePort.accountStatus}`} />
                  <Monitor size={30} />
                  <span>QQ</span>
                </div>
                <div className="qq-app-body">
                  <h3>QQ 客户端登录现场</h3>
                  <p>这里展示纵向真实 QQ 应用窗口。商用部署时由托管安卓 QQ Runtime 执行自动登录并回传状态。</p>
                  <div className="qq-login-form">
                    <input
                      onChange={(event) => setLoginAccount(event.target.value)}
                      placeholder="QQ 账号"
                      value={loginAccount}
                    />
                    <input
                      onChange={(event) => setLoginPassword(event.target.value)}
                      placeholder="QQ 密码"
                      type="password"
                      value={loginPassword}
                    />
                    <button className="run-button" onClick={handlePortLogin} type="button">
                      登录并校验
                    </button>
                  </div>
                  {loginMessage ? (
                    <div
                      className={`login-feedback ${
                        activePort.accountStatus === 'normal' ? 'login-feedback--success' : 'login-feedback--warning'
                      }`}
                    >
                      {loginMessage}
                    </div>
                  ) : null}
                </div>
                <div className="qq-app-footer">
                  <span>账号：{activePort.accountStatus === 'normal' ? activePort.account : '未登录 / 异常'}</span>
                  <strong>{activePort.name}</strong>
                  <span>端口：127.0.0.1:{activePort.port}</span>
                  {activePort.accountStatus === 'abnormal' ? (
                    <button onClick={() => initializePort(activePort.id)} type="button">
                      初始化
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="panel empty-port">
          <HardDriveDownload size={38} />
          <strong>还没有端口</strong>
          <span>点击“生成端口”创建首个 QQ 基础镜像。</span>
        </section>
      )}

      <section className="ports-grid silent-ports">
        {ports.map((port, index) => (
          <button
            className={`port-tile ${activePort?.id === port.id ? 'port-tile--active' : ''}`}
            key={port.id}
            onClick={() => selectPort(port.id)}
            type="button"
          >
            <div className="port-screen">
              <span className={`screen-dot screen-dot--${port.accountStatus}`} />
              <Monitor size={42} />
              <strong>{port.name}</strong>
              <small>127.0.0.1:{port.port}</small>
              {port.accountStatus === 'abnormal' ? (
                <div className="init-hint">
                  账号异常
                  <span>是否初始化？</span>
                </div>
              ) : null}
            </div>
            <div className="port-actions">
              <button
                className="soft-button"
                onClick={(event) => {
                  event.stopPropagation();
                  clonePort(port);
                }}
                type="button"
              >
                <Copy size={15} />
                复制端口
              </button>
              <button
                className="soft-button danger"
                onClick={(event) => {
                  event.stopPropagation();
                  deletePort(port.id);
                }}
                type="button"
              >
                <Trash2 size={15} />
                删除
              </button>
            </div>
            <small className="port-weight">分发序号 #{index + 1}</small>
          </button>
        ))}
      </section>
    </div>
  );
}

function RunnerPage({ onlinePorts, ports, stats }: { onlinePorts: number; ports: EmulatorPort[]; stats: SearchStats }) {
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
            <h2>平均分发策略</h2>
          </div>
          <Bot className="panel-icon" />
        </div>
        <div className="flow-grid">
          {ports.map((port, index) => (
            <div className="flow-card" key={port.id}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{port.name}</strong>
              <small>任务会按轮询策略分配到该端口，端口内只保留独立账号现场。</small>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function SettingsPage() {
  return (
    <div className="page-stack">
      <section className="panel settings-panel">
        <div className="panel__header compact">
          <div>
            <p className="section-kicker">API 配置</p>
            <h2>前端、Vercel 与托管 QQ Runtime 连接方式</h2>
          </div>
          <Settings className="panel-icon" />
        </div>
        <div className="config-list">
          <ConfigRow label="前端搜索地址" value="VITE_QE_SEARCH_ENDPOINT=/api/search" />
          <ConfigRow label="Vercel 转发 Runner" value="QQ_RUNNER_ENDPOINT=https://your-runner.example.com/search" />
          <ConfigRow label="托管 QQ Runtime" value="QQ_RUNNER_ENDPOINT=https://runtime.your-domain.com/search" />
          <ConfigRow label="真实 QQ Bridge" value="QQ_BRIDGE_URLS=http://127.0.0.1:9876/search,..." />
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
                    {(item.result?.tags ?? ['待复核']).map((tag) => (
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

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="config-row">
      <span>{label}</span>
      <code>{value}</code>
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
