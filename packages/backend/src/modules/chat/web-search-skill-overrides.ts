import type {
  AgentWebSearchConfig,
  AgentWebSearchConflictEscalation,
  AgentWebSearchEngine,
  AgentWebSearchLocaleRouting,
} from './agent-tool-config'

const WEB_SEARCH_ENGINES: AgentWebSearchEngine[] = ['tavily', 'brave', 'metaso']
const ROUTING_CN_FIRST: AgentWebSearchLocaleRouting = {
  zh: ['metaso', 'tavily', 'brave'],
  en: ['tavily', 'brave', 'metaso'],
  unknown: ['metaso', 'tavily', 'brave'],
}
const ROUTING_GLOBAL_FIRST: AgentWebSearchLocaleRouting = {
  zh: ['tavily', 'brave', 'metaso'],
  en: ['tavily', 'brave', 'metaso'],
  unknown: ['tavily', 'brave', 'metaso'],
}

const getOverrideValue = (
  overrides: Record<string, unknown>,
  keys: string[],
): unknown => {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      return overrides[key]
    }
  }
  return undefined
}

const cloneLocaleRouting = (
  value: AgentWebSearchLocaleRouting,
): AgentWebSearchLocaleRouting => ({
  zh: Array.isArray(value.zh) ? [...value.zh] : undefined,
  en: Array.isArray(value.en) ? [...value.en] : undefined,
  unknown: Array.isArray(value.unknown) ? [...value.unknown] : undefined,
})

const normalizeEngineList = (value: unknown): AgentWebSearchEngine[] => {
  if (!Array.isArray(value)) return []
  const parsed = value
    .map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
    .filter((item): item is AgentWebSearchEngine =>
      WEB_SEARCH_ENGINES.includes(item as AgentWebSearchEngine),
    )
  return Array.from(new Set(parsed))
}

const parseBoolean = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (['true', '1', 'yes', 'y', 'on', 'enabled'].includes(normalized)) return true
  if (['false', '0', 'no', 'n', 'off', 'disabled'].includes(normalized)) return false
  return null
}

const parseNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim())
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

const parseConflictEscalation = (
  value: unknown,
): AgentWebSearchConflictEscalation | null => {
  if (value === 'auto' || value === 'off') return value
  const boolValue = parseBoolean(value)
  if (boolValue === true) return 'auto'
  if (boolValue === false) return 'off'
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['auto', 'on', 'enabled'].includes(normalized)) return 'auto'
    if (['off', 'none', 'disabled'].includes(normalized)) return 'off'
  }
  return null
}

const parseLocaleRouting = (value: unknown): AgentWebSearchLocaleRouting | undefined => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'auto' || normalized === 'default') return undefined
    if (normalized === 'cn_first' || normalized === 'zh_first') {
      return cloneLocaleRouting(ROUTING_CN_FIRST)
    }
    if (normalized === 'global_first' || normalized === 'en_first') {
      return cloneLocaleRouting(ROUTING_GLOBAL_FIRST)
    }
    return undefined
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const parsed: AgentWebSearchLocaleRouting = {}
  const zh = normalizeEngineList(raw.zh)
  const en = normalizeEngineList(raw.en)
  const unknown = normalizeEngineList(raw.unknown)
  if (zh.length > 0) parsed.zh = zh
  if (en.length > 0) parsed.en = en
  if (unknown.length > 0) parsed.unknown = unknown
  return Object.keys(parsed).length > 0 ? parsed : undefined
}

export const applyWebSearchSkillOverrides = (
  baseConfig: AgentWebSearchConfig,
  overrideRaw: Record<string, unknown> | null | undefined,
  options: {
    sanitizeScope?: (scope?: string) => string | undefined
  } = {},
): AgentWebSearchConfig => {
  const overrides =
    overrideRaw && typeof overrideRaw === 'object' && !Array.isArray(overrideRaw)
      ? overrideRaw
      : {}
  const next: AgentWebSearchConfig = { ...baseConfig }
  const sanitizeScope = options.sanitizeScope

  const scopeOverride = getOverrideValue(overrides, ['scope', 'web_search_scope'])
  if (typeof scopeOverride === 'string') {
    const normalized = sanitizeScope ? sanitizeScope(scopeOverride) : scopeOverride.trim().toLowerCase()
    if (normalized) {
      next.scope = normalized
    }
  }

  const includeSummaryOverride = getOverrideValue(overrides, [
    'includeSummary',
    'include_summary',
    'web_search_include_summary',
  ])
  const includeSummaryParsed = parseBoolean(includeSummaryOverride)
  if (includeSummaryParsed !== null) {
    next.includeSummary = includeSummaryParsed
  }

  const includeRawOverride = getOverrideValue(overrides, [
    'includeRawContent',
    'include_raw',
    'web_search_include_raw',
  ])
  const includeRawParsed = parseBoolean(includeRawOverride)
  if (includeRawParsed !== null) {
    next.includeRawContent = includeRawParsed
  }

  const resultLimitOverride = getOverrideValue(overrides, [
    'resultLimit',
    'result_limit',
    'size',
    'web_search_size',
  ])
  const resultLimitParsed = parseNumber(resultLimitOverride)
  if (resultLimitParsed !== null) {
    next.resultLimit = Math.max(1, Math.min(10, Math.floor(resultLimitParsed)))
  }

  const minSourcesOverride = getOverrideValue(overrides, [
    'minSources',
    'min_sources',
    'web_search_min_sources',
  ])
  const minSourcesParsed = parseNumber(minSourcesOverride)
  if (minSourcesParsed !== null) {
    next.minSources = Math.max(1, Math.min(3, Math.floor(minSourcesParsed)))
  }

  const conflictEscalationOverride = getOverrideValue(overrides, [
    'conflictEscalation',
    'conflict_escalation',
    'web_search_conflict_escalation',
  ])
  const conflictEscalationParsed = parseConflictEscalation(conflictEscalationOverride)
  if (conflictEscalationParsed) {
    next.conflictEscalation = conflictEscalationParsed
  }

  const localeRoutingOverride = getOverrideValue(overrides, [
    'localeRouting',
    'locale_routing',
    'web_search_locale_routing',
  ])
  const localeRoutingParsed = parseLocaleRouting(localeRoutingOverride)
  if (localeRoutingParsed) {
    next.localeRouting = localeRoutingParsed
  } else if (typeof localeRoutingOverride === 'string') {
    const normalized = localeRoutingOverride.trim().toLowerCase()
    if (normalized === 'auto' || normalized === 'default') {
      next.localeRouting = undefined
    }
  }

  return next
}
