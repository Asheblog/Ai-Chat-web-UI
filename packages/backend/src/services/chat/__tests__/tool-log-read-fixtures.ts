/**
 * tool-log 读取测试共用夹具。
 * 只放被多个用例文件复用的原始 JSON / 记录形状，断言留在各自 describe 里。
 */
import type { ToolLogEntry } from '../tool-log-model'

/** 旧存储数组（无信封）：默认一条带 hits 与 details 的 web_search 结果。 */
export const legacyArray = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify([
    {
      id: 'call_1',
      tool: 'web_search',
      stage: 'result',
      createdAt: 1000,
      query: 'q',
      hits: [{ title: 't', url: 'https://example.com/a', snippet: 's' }],
      details: { engine: 'tavily', excerpt: 'x'.repeat(100) },
      ...extra,
    },
  ])

/** 旧 512KB 兜底写入的 compacted 伪记录：stage=result、复用最新 id、summary 写条数。 */
export const LEGACY_COMPACTED_MARKER = {
  id: 'call_1',
  tool: 'web_search',
  stage: 'result',
  createdAt: 1001,
  summary: '124 tool events compacted to fit size limit',
  details: { truncated: true },
}

/** 历史列表投影用例的记录：身份/父子/来源/时间齐全，且带可被省略的 hits/excerpt/attempts。 */
export const HISTORY_LIST_PROJECTION_ENTRY: ToolLogEntry = {
  id: 'call_1',
  callId: 'call_1',
  tool: 'web_search',
  stage: 'result',
  status: 'success',
  phase: 'result',
  source: 'builtin',
  identifier: 'web_search',
  createdAt: 1000,
  updatedAt: 1200,
  endedAt: 1300,
  query: 'q',
  summary: 'ok',
  hits: [{ title: 't', url: 'https://example.com/a', snippet: 's' }],
  details: {
    parentCallId: 'parent_1',
    engine: 'tavily',
    fallbackUsed: 'search_snippet',
    reasoningOffsetStart: 10,
    excerpt: 'x'.repeat(500),
    attempts: [{ engine: 'native', status: 'error' }],
  },
}

/** 列表投影必须保留 truncated 降级证据的记录。 */
export const TRUNCATED_LIST_ENTRY = {
  id: 'call_1',
  tool: 'read_url',
  stage: 'error',
  status: 'error',
  createdAt: 1000,
  hits: [{ title: 't', url: 'https://example.com/a' }],
  details: { truncated: true, excerpt: 'x'.repeat(100) },
}
