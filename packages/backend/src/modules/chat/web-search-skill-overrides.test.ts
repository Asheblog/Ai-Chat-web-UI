import { applyWebSearchSkillOverrides } from './web-search-skill-overrides'
import type { AgentWebSearchConfig } from './agent-tool-config'

const createBaseConfig = (): AgentWebSearchConfig => ({
  enabled: true,
  engines: ['tavily', 'brave', 'metaso'],
  engineOrder: ['tavily', 'brave', 'metaso'],
  apiKeys: {
    tavily: 'k1',
    brave: 'k2',
    metaso: 'k3',
  },
  resultLimit: 4,
  domains: [],
  parallelMaxEngines: 3,
  parallelMaxQueriesPerCall: 2,
  parallelTimeoutMs: 12000,
  mergeStrategy: 'hybrid_score_v1',
  autoBilingual: true,
  autoBilingualMode: 'conditional',
  autoReadAfterSearch: true,
  autoReadTopK: 2,
  autoReadParallelism: 2,
  autoReadTimeoutMs: 18000,
  autoReadMaxContentLength: 24000,
  conflictEscalation: 'auto',
})

describe('applyWebSearchSkillOverrides', () => {
  it('applies min_sources, conflict_escalation and locale_routing preset', () => {
    const next = applyWebSearchSkillOverrides(
      createBaseConfig(),
      {
        min_sources: 1,
        conflict_escalation: 'off',
        locale_routing: 'cn_first',
      },
      {
        sanitizeScope: () => undefined,
      },
    )

    expect(next.minSources).toBe(1)
    expect(next.conflictEscalation).toBe('off')
    expect(next.localeRouting).toEqual({
      zh: ['metaso', 'tavily', 'brave'],
      en: ['tavily', 'brave', 'metaso'],
      unknown: ['metaso', 'tavily', 'brave'],
    })
  })

  it('supports legacy web_search_* aliases', () => {
    const next = applyWebSearchSkillOverrides(
      createBaseConfig(),
      {
        web_search_min_sources: 2,
        web_search_conflict_escalation: true,
        web_search_locale_routing: {
          zh: ['brave', 'metaso'],
        },
      },
      {
        sanitizeScope: () => undefined,
      },
    )

    expect(next.minSources).toBe(2)
    expect(next.conflictEscalation).toBe('auto')
    expect(next.localeRouting).toEqual({
      zh: ['brave', 'metaso'],
    })
  })

  it('keeps defaults for invalid values', () => {
    const next = applyWebSearchSkillOverrides(
      createBaseConfig(),
      {
        min_sources: 'invalid',
        conflict_escalation: 'invalid',
        locale_routing: 123,
      },
      {
        sanitizeScope: () => undefined,
      },
    )

    expect(next.minSources).toBeUndefined()
    expect(next.conflictEscalation).toBe('auto')
    expect(next.localeRouting).toBeUndefined()
  })
})
