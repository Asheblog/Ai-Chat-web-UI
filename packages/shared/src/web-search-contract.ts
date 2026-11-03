/** 搜索引擎身份的单一来源，运行时、设置校验和 UI 共用。 */
export const WEB_SEARCH_ENGINE_IDS = ['tavily', 'brave', 'metaso', 'exa', 'deepseek'] as const

export type WebSearchEngine = (typeof WEB_SEARCH_ENGINE_IDS)[number]

export const isWebSearchEngine = (value: unknown): value is WebSearchEngine =>
  typeof value === 'string' && WEB_SEARCH_ENGINE_IDS.includes(value as WebSearchEngine)
