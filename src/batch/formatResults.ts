/** 与批量识别输出一致的行结构（序号 / 手机号 / 命中 / QQ / 识别路径 / 备注） */

export type BatchRecordInput = {
  phone: string;
  qq?: string;
  opened?: boolean;
  path?: string;
  error?: string;
  error_type?: string;
  query_time?: string;
  retry_count?: number;
};

export type BatchResultRow = {
  index: number;
  phone: string;
  hit: boolean;
  hitLabel: '是' | '否';
  qq: string;
  path: string;
  note: string;
};

export const mapBatchRecordsToRows = (records: BatchRecordInput[]): BatchResultRow[] =>
  records.map((record, i) => {
    const hit = Boolean(record.opened && record.qq);
    const note = record.error
      ? String(record.error).slice(0, 60)
      : record.error_type
        ? String(record.error_type)
        : '';
    return {
      index: i + 1,
      phone: record.phone,
      hit,
      hitLabel: hit ? '是' : '否',
      qq: hit ? String(record.qq) : '-',
      path: String(record.path ?? '').trim() || '-',
      note,
    };
  });

export const summarizeBatchRows = (rows: BatchResultRow[]) => {
  const total = rows.length;
  const hitCount = rows.filter((r) => r.hit).length;
  return { total, hitCount, missCount: total - hitCount };
};

const TABLE_HEADER = ['序号', '手机号', '命中', 'QQ', '识别路径', '备注'] as const;

export const formatBatchResultsTsv = (rows: BatchResultRow[], options?: { includeSummary?: boolean }) => {
  const lines: string[] = [];
  if (options?.includeSummary !== false && rows.length) {
    const { total, hitCount, missCount } = summarizeBatchRows(rows);
    lines.push(`合计 ${total} | 命中 ${hitCount} | 未命中 ${missCount}`, '');
  }
  lines.push(TABLE_HEADER.join('\t'));
  for (const row of rows) {
    lines.push([row.index, row.phone, row.hitLabel, row.qq, row.path, row.note].join('\t'));
  }
  return lines.join('\n');
};

export const formatBatchResultsCsv = (rows: BatchResultRow[]) => {
  const escape = (cell: string | number) => `"${String(cell ?? '').replace(/"/g, '""')}"`;
  const header = TABLE_HEADER.join(',');
  const body = rows.map((row) =>
    [row.index, row.phone, row.hitLabel, row.qq, row.path, row.note].map(escape).join(','),
  );
  return `\uFEFF${[header, ...body].join('\n')}`;
};
