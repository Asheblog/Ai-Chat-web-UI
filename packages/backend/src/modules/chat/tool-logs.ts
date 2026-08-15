import type { WebSearchHit } from '../../utils/web-search';

export type ToolLogStage = 'start' | 'result' | 'error';

export interface ToolLogDetails {
  code?: string;
  input?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  durationMs?: number;
  truncated?: boolean;
  [key: string]: unknown;
}

export type ToolLogEntry = {
  id: string;
  tool: string;
  stage: ToolLogStage;
  status?: 'running' | 'success' | 'error' | 'pending' | 'rejected' | 'aborted';
  phase?: string;
  callId?: string;
  query?: string;
  hits?: WebSearchHit[];
  error?: string;
  summary?: string;
  createdAt: number;
  details?: ToolLogDetails;
};

const HIT_SNIPPET_MAX_CHARS = 200;
const MAX_HITS_COUNT = 10;
const DETAIL_STRING_FIELD_MAX_CHARS = 500;
const DETAIL_ARRAY_FIELD_MAX_ITEMS = 20;
const QUERY_MAX_CHARS = 500;
const SUMMARY_MAX_CHARS = 500;
const ERROR_MAX_CHARS = 500;

/**
 * 对工具日志条目进行持久化瘦身，返回新对象（不修改原始对象）。
 * - hits: 保留 title/url/imageUrl/thumbnailUrl，snippet 截断，删除 content
 * - details: 截断大字符串字段，数组裁剪，标记 truncated
 */
export const sanitizeToolLogEntryForPersistence = (entry: ToolLogEntry): ToolLogEntry => {
  const result: ToolLogEntry = {
    id: entry.id,
    tool: entry.tool,
    stage: entry.stage,
    createdAt: entry.createdAt,
  };
  if (entry.status) result.status = entry.status;
  if (entry.phase) result.phase = entry.phase;
  if (entry.callId) result.callId = entry.callId;
  if (entry.query) result.query = entry.query.length > QUERY_MAX_CHARS ? entry.query.slice(0, QUERY_MAX_CHARS) : entry.query;
  if (entry.error) result.error = entry.error.length > ERROR_MAX_CHARS ? entry.error.slice(0, ERROR_MAX_CHARS) : entry.error;
  if (entry.summary) result.summary = entry.summary.length > SUMMARY_MAX_CHARS ? entry.summary.slice(0, SUMMARY_MAX_CHARS) : entry.summary;

  if (Array.isArray(entry.hits) && entry.hits.length > 0) {
    result.hits = entry.hits.slice(0, MAX_HITS_COUNT).map((hit) => {
      const slim: WebSearchHit = {
        title: hit.title,
        url: hit.url,
      };
      if (hit.imageUrl) slim.imageUrl = hit.imageUrl;
      if (hit.thumbnailUrl) slim.thumbnailUrl = hit.thumbnailUrl;
      if (hit.snippet) {
        slim.snippet = hit.snippet.length > HIT_SNIPPET_MAX_CHARS
          ? hit.snippet.slice(0, HIT_SNIPPET_MAX_CHARS)
          : hit.snippet;
      }
      return slim;
    });
  }

  if (entry.details && Object.keys(entry.details).length > 0) {
    const d = entry.details;
    const sanitized: ToolLogDetails = {};
    let truncated = false;

    const truncateStr = (val: string | undefined, max: number): string | undefined => {
      if (val === undefined) return undefined;
      if (val.length > max) { truncated = true; return val.slice(0, max); }
      return val;
    };

    if (typeof d.code === 'string') sanitized.code = truncateStr(d.code, DETAIL_STRING_FIELD_MAX_CHARS);
    if (typeof d.input === 'string') sanitized.input = truncateStr(d.input, DETAIL_STRING_FIELD_MAX_CHARS);
    if (typeof d.stdout === 'string') sanitized.stdout = truncateStr(d.stdout, DETAIL_STRING_FIELD_MAX_CHARS);
    if (typeof d.stderr === 'string') sanitized.stderr = truncateStr(d.stderr, DETAIL_STRING_FIELD_MAX_CHARS);
    if (typeof d.exitCode === 'number') sanitized.exitCode = d.exitCode;
    if (typeof d.durationMs === 'number') sanitized.durationMs = d.durationMs;

    // Handle known large fields via index signature
    const largeTextKeys = ['resultText', 'excerpt', 'content', 'attempts'] as const;
    for (const key of largeTextKeys) {
      const val = (d as Record<string, unknown>)[key];
      if (typeof val === 'string') {
        (sanitized as Record<string, unknown>)[key] = truncateStr(val, DETAIL_STRING_FIELD_MAX_CHARS);
      } else if (Array.isArray(val)) {
        const sliced = val.slice(0, DETAIL_ARRAY_FIELD_MAX_ITEMS);
        if (sliced.length < val.length) truncated = true;
        (sanitized as Record<string, unknown>)[key] = sliced;
      }
    }

    // Copy remaining details fields (non-large-text keys)
    for (const [key, value] of Object.entries(d)) {
      if (
        key === 'code' || key === 'input' || key === 'stdout' || key === 'stderr' ||
        key === 'exitCode' || key === 'durationMs' || key === 'truncated' ||
        largeTextKeys.includes(key as any)
      ) continue;
      if (value != null) {
        (sanitized as Record<string, unknown>)[key] = value;
      }
    }

    if (truncated) sanitized.truncated = true;
    if (Object.keys(sanitized).length > 0) result.details = sanitized;
  }

  return result;
};

const DEFAULT_TOOL_LOGS_MAX_BYTES = 512 * 1024; // 512KB

/** 压缩级别 1：保留摘要字段，去掉 hits 和 details 内容 */
const compressToSummary = (entry: ToolLogEntry): ToolLogEntry => ({
  id: entry.id,
  tool: entry.tool,
  stage: entry.stage,
  createdAt: entry.createdAt,
  status: entry.status,
  query: entry.query,
  summary: entry.summary,
  error: entry.error,
  details: entry.details ? { truncated: true } : undefined,
});

/** 压缩级别 2：极简摘要，只保留标识和截断标记 */
const compressToExtreme = (entry: ToolLogEntry): ToolLogEntry => ({
  id: entry.id,
  tool: entry.tool,
  stage: entry.stage,
  createdAt: entry.createdAt,
  details: { truncated: true },
});

/** 压缩级别 3：单条 compacted marker（只剩一条极简记录） */
const makeCompactedMarker = (originalCount: number, latest: ToolLogEntry): ToolLogEntry => {
  const raw = `${originalCount} tool events compacted to fit size limit`;
  return {
    id: latest.id || 'compacted',
    tool: latest.tool || 'compacted',
    stage: 'result',
    createdAt: latest.createdAt || Date.now(),
    summary: raw.length > SUMMARY_MAX_CHARS ? raw.slice(0, SUMMARY_MAX_CHARS) : raw,
    details: { truncated: true },
  };
};

/**
 * 统一的工具日志持久化序列化入口，保证返回 JSON 的字节长度 ≤ maxBytes。
 *
 * 压缩策略（渐进式，进入下一级仅当上一级仍超限）：
 * 1. 对每个 entry 执行 sanitize 瘦身
 * 2. 中间条目（除首 N 尾 M）压缩为摘要
 * 3. 全部条目压缩为摘要
 * 4. 全部条目压缩为极简摘要
 * 5. 逐步丢弃较旧条目，保留最新 K 条
 * 6. 最终兜底：单条 compacted marker
 * 空数组返回 null
 */
export const serializeToolLogsForPersistence = (
  logs: ToolLogEntry[],
  maxBytes?: number,
): string | null => {
  if (!Array.isArray(logs) || logs.length === 0) return null;

  const limit = maxBytes ?? DEFAULT_TOOL_LOGS_MAX_BYTES;

  // Step 1: sanitize all entries
  let working = logs.map(sanitizeToolLogEntryForPersistence);
  let json = '';
  let byteLength = 0;

  const stringifyAndCheck = (arr: ToolLogEntry[]): boolean => {
    json = JSON.stringify(arr);
    byteLength = Buffer.byteLength(json, 'utf-8');
    return byteLength <= limit;
  };

  if (stringifyAndCheck(working)) return json;

  // Step 2: compress middle entries (keep first 2 and last 5 full)
  if (working.length > 7) {
    const COMPRESS_KEEP_FIRST = 2;
    const COMPRESS_KEEP_LAST = 5;
    const compressed: ToolLogEntry[] = [];
    for (let i = 0; i < working.length; i++) {
      if (i < COMPRESS_KEEP_FIRST || i >= working.length - COMPRESS_KEEP_LAST) {
        compressed.push(working[i]);
      } else {
        compressed.push(compressToSummary(working[i]));
      }
    }
    if (stringifyAndCheck(compressed)) return json;
    working = compressed;
  }

  // Step 3: compress ALL entries to summary
  {
    const allCompressed = working.map(compressToSummary);
    if (stringifyAndCheck(allCompressed)) return json;
    working = allCompressed;
  }

  // Step 4: compress ALL entries to extreme summary
  {
    const extreme = working.map(compressToExtreme);
    if (stringifyAndCheck(extreme)) return json;
    working = extreme;
  }

  // Step 5: binary search for smallest keep count that fits (O(log N) iterations)
  let lo = 1;
  let hi = working.length;
  let bestKeep = 0;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const subset = working.slice(working.length - mid);
    if (stringifyAndCheck(subset)) {
      bestKeep = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (bestKeep > 0) return json;

  // Step 6: final safety net — single compacted marker
  const marker = makeCompactedMarker(logs.length, working[working.length - 1]);
  json = JSON.stringify([marker]);
  byteLength = Buffer.byteLength(json, 'utf-8');
  return json;
};

/** 历史会话列表 API 保留的 details 字段（CoT 折叠/分组所需）。hitsCount 单独派生。 */
const HISTORY_LIST_DETAIL_KEYS = [
  'reasoningOffset',
  'reasoningOffsetStart',
  'reasoningOffsetEnd',
  'taskType',
  'engine',
  'queryLanguage',
  'originalQuery',
  'expandedQuery',
  'groupId',
  'parentCallId',
  'url',
  'title',
  'truncated',
] as const

/** richPayload 证据图所需；投影前保留，响应前由 projectToolEventsForHistoryList 去掉。 */
const HISTORY_LIST_RICH_IMAGE_DETAIL_KEYS = ['assessedImages', 'images', 'leadImageUrl'] as const

export type ParseToolLogsOptions = {
  mode?: 'full' | 'history-list'
}

const countValidHits = (hits: unknown): number => {
  if (!Array.isArray(hits)) return 0
  let count = 0
  for (const hit of hits) {
    if (!hit || typeof hit !== 'object') continue
    const record = hit as Record<string, unknown>
    if (typeof record.title === 'string' || typeof record.url === 'string') count += 1
  }
  return count
}

/**
 * 历史消息列表投影：去掉 hits[] 与大体量 details，保留 CoT 时间线必需字段。
 * richPayload 应在投影前用完整 toolEvents 构建。
 */
export const projectToolEventsForHistoryList = (entries: ToolLogEntry[]): ToolLogEntry[] => {
  if (!Array.isArray(entries) || entries.length === 0) return []

  return entries.map((entry) => {
    const slim: ToolLogEntry = {
      id: entry.id,
      tool: entry.tool,
      stage: entry.stage,
      createdAt: entry.createdAt,
    }
    if (entry.status) slim.status = entry.status
    if (entry.phase) slim.phase = entry.phase
    if (entry.callId) slim.callId = entry.callId
    if (entry.query) slim.query = entry.query
    if (entry.error) slim.error = entry.error
    if (entry.summary) slim.summary = entry.summary

    const details: ToolLogDetails = {}
    const source = entry.details || {}
    for (const key of HISTORY_LIST_DETAIL_KEYS) {
      const value = (source as Record<string, unknown>)[key]
      if (value != null) {
        ;(details as Record<string, unknown>)[key] = value
      }
    }

    const explicitHitsCount =
      typeof (source as Record<string, unknown>).hitsCount === 'number'
        ? ((source as Record<string, unknown>).hitsCount as number)
        : null
    const hitsLen = countValidHits(entry.hits)
    if (explicitHitsCount != null) {
      details.hitsCount = explicitHitsCount
    } else if (hitsLen > 0) {
      details.hitsCount = hitsLen
    }

    if (Object.keys(details).length > 0) {
      slim.details = details
    }
    return slim
  })
}

export const parseToolLogsJson = (
  raw?: string | null,
  options?: ParseToolLogsOptions,
): ToolLogEntry[] => {
  if (!raw) return [];
  const mode = options?.mode === 'history-list' ? 'history-list' : 'full'
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const legacyPending = new Map<string, Array<{ id: string; createdAt: number }>>();
    let legacyCounter = 0;
    const LEGACY_WINDOW = 15_000;

    const legacyKey = (tool: string, query?: string) =>
      `${tool}::${(query || '').trim().toLowerCase()}`;

    const allocateLegacyId = (
      key: string,
      stage: ToolLogStage,
      createdAt: number,
    ): string => {
      if (stage === 'start') {
        const id = `legacy:${key}:${legacyCounter++}`;
        const queue = legacyPending.get(key) ?? [];
        queue.push({ id, createdAt });
        legacyPending.set(key, queue);
        return id;
      }
      const queue = legacyPending.get(key);
      if (queue && queue.length > 0) {
        while (queue.length > 0 && createdAt - queue[0].createdAt > LEGACY_WINDOW) {
          queue.shift();
        }
        if (queue.length > 0) {
          const match = queue.shift()!;
          if (queue.length === 0) {
            legacyPending.delete(key);
          } else {
            legacyPending.set(key, queue);
          }
          return match.id;
        }
      }
      return `legacy:${key}:${legacyCounter++}`;
    };

    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const stage = entry.stage;
        if (stage !== 'start' && stage !== 'result' && stage !== 'error') return null;
        const tool = typeof entry.tool === 'string' && entry.tool.trim() ? entry.tool : 'unknown';
        const createdAtRaw =
          typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt)
            ? entry.createdAt
            : Date.now();
        const query = typeof entry.query === 'string' ? entry.query : undefined;
        const id =
          typeof entry.id === 'string' && entry.id.trim()
            ? entry.id.trim()
            : allocateLegacyId(legacyKey(tool, query), stage, createdAtRaw);
        const log: ToolLogEntry = {
          id,
          tool,
          stage,
          query,
          createdAt: createdAtRaw,
        };
        if (
          typeof entry.status === 'string' &&
          ['running', 'success', 'error', 'pending', 'rejected', 'aborted'].includes(entry.status)
        ) {
          log.status = entry.status as ToolLogEntry['status'];
        }
        if (typeof entry.phase === 'string' && entry.phase.trim()) {
          log.phase = entry.phase;
        }
        if (typeof entry.callId === 'string' && entry.callId.trim()) {
          log.callId = entry.callId;
        }

        const hitsCountFromArray = countValidHits(entry.hits)
        if (mode === 'full' && Array.isArray(entry.hits)) {
          log.hits = entry.hits
            .map((hit: any) => {
              if (!hit || typeof hit !== 'object') return null;
              const title = typeof hit.title === 'string' ? hit.title : '';
              const url = typeof hit.url === 'string' ? hit.url : '';
              if (!title && !url) return null;
              const normalized: WebSearchHit = {
                title,
                url,
              };
              if (typeof hit.snippet === 'string') normalized.snippet = hit.snippet;
              if (typeof hit.content === 'string') normalized.content = hit.content;
              if (typeof hit.imageUrl === 'string') normalized.imageUrl = hit.imageUrl;
              if (typeof hit.image_url === 'string' && !normalized.imageUrl) {
                normalized.imageUrl = hit.image_url;
              }
              if (typeof hit.thumbnailUrl === 'string') normalized.thumbnailUrl = hit.thumbnailUrl;
              if (typeof hit.thumbnail_url === 'string' && !normalized.thumbnailUrl) {
                normalized.thumbnailUrl = hit.thumbnail_url;
              }
              if (typeof hit.thumbnail === 'string' && !normalized.thumbnailUrl) {
                normalized.thumbnailUrl = hit.thumbnail;
              }
              return normalized;
            })
            .filter((hit: WebSearchHit | null): hit is WebSearchHit => Boolean(hit));
        }

        if (typeof entry.error === 'string' && entry.error.trim()) {
          log.error = entry.error;
        }
        if (typeof entry.summary === 'string' && entry.summary.trim()) {
          log.summary = entry.summary.trim();
        }
        if (entry.details && typeof entry.details === 'object') {
          const candidate = entry.details as Record<string, unknown>;
          const normalized: ToolLogDetails = {};
          if (mode === 'history-list') {
            for (const key of HISTORY_LIST_DETAIL_KEYS) {
              const value = candidate[key]
              if (value != null) (normalized as Record<string, unknown>)[key] = value
            }
            for (const key of HISTORY_LIST_RICH_IMAGE_DETAIL_KEYS) {
              const value = candidate[key]
              if (value != null) (normalized as Record<string, unknown>)[key] = value
            }
            const explicitHitsCount =
              typeof candidate.hitsCount === 'number' ? candidate.hitsCount : null
            if (explicitHitsCount != null) {
              normalized.hitsCount = explicitHitsCount
            } else if (hitsCountFromArray > 0) {
              normalized.hitsCount = hitsCountFromArray
            }
          } else {
            if (typeof candidate.code === 'string') normalized.code = candidate.code;
            if (typeof candidate.input === 'string') normalized.input = candidate.input;
            if (typeof candidate.stdout === 'string') normalized.stdout = candidate.stdout;
            if (typeof candidate.stderr === 'string') normalized.stderr = candidate.stderr;
            if (typeof candidate.exitCode === 'number' && Number.isFinite(candidate.exitCode)) {
              normalized.exitCode = candidate.exitCode;
            }
            if (typeof candidate.durationMs === 'number' && Number.isFinite(candidate.durationMs)) {
              normalized.durationMs = candidate.durationMs;
            }
            if (typeof candidate.truncated === 'boolean') normalized.truncated = candidate.truncated;
            for (const [key, value] of Object.entries(candidate)) {
              if (
                key === 'code' ||
                key === 'input' ||
                key === 'stdout' ||
                key === 'stderr' ||
                key === 'exitCode' ||
                key === 'durationMs' ||
                key === 'truncated'
              ) {
                continue;
              }
              if (value !== undefined) {
                normalized[key] = value;
              }
            }
          }
          if (Object.keys(normalized).length > 0) {
            log.details = normalized;
          }
        } else if (mode === 'history-list' && hitsCountFromArray > 0) {
          log.details = { hitsCount: hitsCountFromArray }
        }
        return log;
      })
      .filter((entry): entry is ToolLogEntry => Boolean(entry));
  } catch {
    return [];
  }
};
