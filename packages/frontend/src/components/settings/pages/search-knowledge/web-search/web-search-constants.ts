import { WEB_SEARCH_ENGINE_IDS, WEB_SEARCH_SCOPE_IDS } from "@aichat/shared"
import type { WebSearchScope } from "@aichat/shared"
import type { WebSearchBilingualMode, WebSearchEngine } from "@/types"

/** 边界与引擎列表归一化都来自 shared 契约：前端表单、后端校验与设置解码共用一份。 */
export { WEB_SEARCH_RANGES, normalizeWebSearchEngines as normalizeEngineList } from "@aichat/shared"

export const ENGINE_LABELS: Record<WebSearchEngine, string> = {
  tavily: "Tavily",
  brave: "Brave",
  metaso: "Metaso（秘塔）",
  exa: "Exa",
  deepseek: "DeepSeek",
}

export const ENGINE_OPTIONS = WEB_SEARCH_ENGINE_IDS.map((value) => ({
  value,
  label: ENGINE_LABELS[value],
}))

export const SCOPE_LABELS: Record<WebSearchScope, string> = {
  webpage: "网页",
  document: "文档",
  paper: "论文",
  scholar: "学术",
  image: "图片",
  video: "视频",
  podcast: "播客",
}

export const SCOPE_OPTIONS = WEB_SEARCH_SCOPE_IDS.map((value) => ({
  value,
  label: SCOPE_LABELS[value],
}))

/** 支持在搜索阶段返回网页原文的引擎；Brave 没有对应参数，Metaso 仅网页范围生效。 */
export const RAW_CONTENT_ENGINES: WebSearchEngine[] = ["tavily", "exa", "metaso", "deepseek"]
/** 支持摘要召回增强的引擎。 */
export const SUMMARY_ENGINES: WebSearchEngine[] = ["metaso", "exa"]

export const BILINGUAL_MODE_OPTIONS: Array<{
  value: WebSearchBilingualMode
  label: string
  hint: string
}> = [
  { value: "off", label: "关闭", hint: "只用原查询检索。" },
  { value: "conditional", label: "按需扩展", hint: "查询语种不明或涉及跨语种主题时补一条中/英查询。" },
  { value: "always", label: "总是扩展", hint: "每次检索都追加一条另一种语言的查询。" },
]

export const clampToRange = (value: number, range: { min: number; max: number }) =>
  Math.max(range.min, Math.min(range.max, Math.round(value)))

export const normalizeDomains = (text: string) =>
  text
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)

export const arraysEqual = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((item, idx) => item === right[idx])

/** 引擎是否可用于「获取网页原文 / 召回增强」这类按引擎分化的开关。 */
export const hasAnyEngine = (engines: readonly WebSearchEngine[], candidates: readonly WebSearchEngine[]) =>
  engines.some((engine) => candidates.includes(engine))
