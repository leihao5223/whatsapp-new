import {
  Activity,
  ArrowRight,
  CheckCircle2,
  DatabaseZap,
  Download,
  FileText,
  Gauge,
  Link2,
  Pause,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { type ChangeEvent, type ReactNode, useMemo, useRef, useState } from 'react';
import './styles.css';

type QueryStatus = 'pending' | 'running' | 'matched' | 'empty' | 'failed';

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

const categoryTone: Record<SearchResult['category'], string> = {
  高价值: 'success',
  待复核: 'warning',
  无效线索: 'muted',
};

const demoLines = ['QQ: 19888990001', 'wxid_alpha_2949', '13800138000', 'market-data-node', 'unknown-empty-case'];
const searchEndpoint = import.meta.env.VITE_QE_SEARCH_ENDPOINT as string | undefined;

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
    summary: `已根据输入 "${query}" 生成标准化线索，可在后续接入真实 QQ 搜索框或后端 API 后替换模拟引擎。`,
    tags: [query.includes('@') ? '邮箱' : '文本', /\d{6,}/.test(query) ? '数字账号' : '关键词', '自动整理'],
  };
};

const normalizeCategory = (category?: string): SearchResult['category'] => {
  if (category === '高价值' || category === '待复核' || category === '无效线索') {
    return category;
  }

  return '待复核';
};

const searchQuery = async (query: string): Promise<SearchResult | null> => {
  if (!searchEndpoint) {
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
    throw new Error(`搜索接口异常：${response.status}`);
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
    summary: data.summary ?? '接口已返回结果，请在后端补充摘要字段以提升整理质量。',
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
  const [items, setItems] = useState<QueryItem[]>([]);
  const [manualValue, setManualValue] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
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

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="hero__content">
          <div className="eyebrow">
            <Sparkles size={16} />
            QE Intelligence Console
          </div>
          <h1>面向 TXT 批量输入的 QE 数据整理系统</h1>
          <p>
            上传每行一组数据的 TXT 文件，系统会按队列逐条送入搜索流程，并把返回结果自动整理到分类表格中。
            当前版本内置模拟搜索引擎，后续可替换为真实 QQ 搜索框自动化或服务端查询接口。
          </p>
          <div className="hero__actions">
            <label className="primary-upload">
              <UploadCloud size={20} />
              上传 TXT 数据
              <input type="file" accept=".txt,text/plain" onChange={handleFileUpload} />
            </label>
            <button type="button" onClick={loadDemoData} className="ghost-button">
              载入演示数据
            </button>
          </div>
        </div>
        <div className="hero-card">
          <div className="orb" />
          <DatabaseZap size={42} />
          <span>Data Orbit</span>
          <strong>{completionRate}%</strong>
          <small>整理进度</small>
        </div>
      </section>

      <section className="metrics-grid" aria-label="数据处理指标">
        <MetricCard icon={<FileText />} label="总数据" value={stats.total} />
        <MetricCard icon={<CheckCircle2 />} label="有结果" value={stats.matched} tone="success" />
        <MetricCard icon={<XCircle />} label="无结果" value={stats.empty} tone="warning" />
        <MetricCard icon={<Gauge />} label="待处理" value={stats.pending} />
      </section>

      <section className="workspace-grid">
        <div className="panel intake-panel">
          <div className="panel__header">
            <div>
              <p className="section-kicker">01 / 数据整理区域</p>
              <h2>输入队列</h2>
            </div>
            <ShieldCheck className="panel-icon" />
          </div>

          <div className="manual-entry">
            <Search size={18} />
            <input
              value={manualValue}
              onChange={(event) => setManualValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  addManualQuery();
                }
              }}
              placeholder="手动输入单条或多行数据，回车加入队列"
            />
            <button type="button" onClick={addManualQuery}>
              加入
            </button>
          </div>

          <div className="control-row">
            <button type="button" className="run-button" onClick={runSearch} disabled={isRunning || !items.length}>
              {isRunning ? <Activity size={18} /> : <Play size={18} />}
              {isRunning ? '运行中' : '开始批量搜索'}
            </button>
            <button type="button" className="soft-button" onClick={stopSearch} disabled={!isRunning}>
              <Pause size={18} />
              暂停
            </button>
            <button type="button" className="soft-button" onClick={resetWorkspace}>
              <RotateCcw size={18} />
              重置
            </button>
          </div>

          <div className="queue-list">
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
          <div className="panel__header">
            <div>
              <p className="section-kicker">02 / 结果表格</p>
              <h2>搜索返回与分类</h2>
            </div>
            <button type="button" className="export-button" onClick={exportResults} disabled={!items.length}>
              <Download size={17} />
              导出 CSV
            </button>
          </div>

          <div className="connector-note">
            <Link2 size={16} />
            搜索适配器：未配置接口时使用 QE 模拟引擎；配置 VITE_QE_SEARCH_ENDPOINT 后会调用真实搜索服务。
            <ArrowRight size={16} />
          </div>

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
        </div>
      </section>
    </main>
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
  value: number;
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
      <UploadCloud size={34} />
      <strong>上传 TXT 或手动输入数据</strong>
      <span>每行会生成一条待搜索任务，适合批量整理 QQ 搜索返回结果。</span>
    </div>
  );
}

export default App;
