import { WEB_SEARCH_AUTO_READ_BATCH_TIMEOUT_MS } from './settings-contract.js'

/** 搜索引擎身份的单一来源，运行时、设置校验和 UI 共用。 */
export const WEB_SEARCH_ENGINE_IDS = ['tavily', 'brave', 'metaso', 'exa', 'deepseek'] as const

export type WebSearchEngine = (typeof WEB_SEARCH_ENGINE_IDS)[number]

export const isWebSearchEngine = (value: unknown): value is WebSearchEngine =>
  typeof value === 'string' && WEB_SEARCH_ENGINE_IDS.includes(value as WebSearchEngine)

/**
 * 跨引擎统一的搜索范围词汇。各引擎在适配层映射到自己的 scope 命名
 * （例如 Metaso 官方只有 scholar，项目词汇的 paper 在适配层映射过去）。
 */
export const WEB_SEARCH_SCOPE_IDS = [
  'webpage',
  'document',
  'paper',
  'scholar',
  'image',
  'video',
  'podcast',
] as const

export type WebSearchScope = (typeof WEB_SEARCH_SCOPE_IDS)[number]

export const isWebSearchScope = (value: unknown): value is WebSearchScope =>
  typeof value === 'string' && WEB_SEARCH_SCOPE_IDS.includes(value as WebSearchScope)

/**
 * 数值边界：后端 zod 校验、运行时 clamp、设置解码与前端表单共用这一处声明。
 * 有效值语义与既有实现一致（resultLimit 1-10、并行引擎数不超过引擎总数等），
 * fallback 是各调用点在缺省/不可解析时使用的默认值。
 */
export const WEB_SEARCH_RANGES = {
  resultLimit: { min: 1, max: 10, fallback: 4 },
  parallelMaxEngines: { min: 1, max: WEB_SEARCH_ENGINE_IDS.length, fallback: 3 },
  parallelMaxQueriesPerCall: { min: 1, max: 3, fallback: 2 },
  parallelTimeoutMs: { min: 1000, max: 120000, fallback: 12000 },
  autoReadParallelism: { min: 1, max: 4, fallback: 2 },
  autoReadBatchTimeoutMs: WEB_SEARCH_AUTO_READ_BATCH_TIMEOUT_MS,
} as const

const toWebSearchEngineCandidates = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return []
  const trimmed = value.trim()
  if (trimmed === '') return []
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return trimmed.split(/[,\n]/)
}

/**
 * 归一化有序启用引擎列表，settings 持久化值、API 载荷与 UI 草稿共用。
 *
 * - 接受数组、JSON 数组字符串、逗号或换行分隔的字符串
 * - 逐项 trim + lowercase，按引擎 id 校验，去重并保留首次出现顺序
 * - 没有可用项时返回 fallback 的副本，fallback 默认 ['tavily']
 * - 显式传 [] 表示该调用点允许空集合（例如可清空的勾选集合）；UI 仍需至少保留一个引擎
 */
export const normalizeWebSearchEngines = (
  value: unknown,
  fallback: readonly WebSearchEngine[] = ['tavily'],
): WebSearchEngine[] => {
  const normalized: WebSearchEngine[] = []
  for (const candidate of toWebSearchEngineCandidates(value)) {
    if (typeof candidate !== 'string') continue
    const lowered = candidate.trim().toLowerCase()
    if (isWebSearchEngine(lowered) && !normalized.includes(lowered)) normalized.push(lowered)
  }
  return normalized.length > 0 ? normalized : [...fallback]
}
