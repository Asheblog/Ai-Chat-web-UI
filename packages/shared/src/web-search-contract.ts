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
