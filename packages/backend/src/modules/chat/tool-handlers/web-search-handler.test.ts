import type { WebSearchParallelResult } from '../../../utils/web-search'
import {
  buildLanguageAwareSearchPlan,
  evaluateSearchEscalation,
} from './web-search-handler'

describe('buildLanguageAwareSearchPlan', () => {
  it('prioritizes metaso for Chinese query and keeps fallback engines', () => {
    const plan = buildLanguageAwareSearchPlan({
      originalQuery: 'AI 芯片 架构 对比',
      expandedQueries: [
        { query: 'AI 芯片 架构 对比', queryLanguage: 'zh' },
        { query: 'AI chip architecture comparison English sources', queryLanguage: 'en' },
      ],
      activeEngines: ['tavily', 'brave', 'metaso'],
      engineOrder: ['tavily', 'brave', 'metaso'],
    })

    expect(plan.requiredSources).toBe(2)
    expect(plan.queryPlans[0].engines).toEqual(['metaso', 'tavily'])
    expect(plan.queryPlans[1].engines).toEqual(['tavily'])
    expect(plan.fallbackEngines).toEqual(['brave'])
  })

  it('prioritizes western engines for English query', () => {
    const plan = buildLanguageAwareSearchPlan({
      originalQuery: 'OpenAI model release notes',
      expandedQueries: [{ query: 'OpenAI model release notes', queryLanguage: 'en' }],
      activeEngines: ['metaso', 'brave', 'tavily'],
      engineOrder: ['metaso', 'brave', 'tavily'],
    })

    expect(plan.requiredSources).toBe(2)
    expect(plan.queryPlans[0].engines).toEqual(['tavily', 'brave'])
  })

  it('requires three sources for high-risk query when possible', () => {
    const plan = buildLanguageAwareSearchPlan({
      originalQuery: 'today stock market outlook',
      expandedQueries: [{ query: 'today stock market outlook', queryLanguage: 'en' }],
      activeEngines: ['metaso', 'brave', 'tavily'],
      engineOrder: ['tavily', 'brave', 'metaso'],
    })

    expect(plan.requiredSources).toBe(3)
    expect(plan.queryPlans[0].engines).toEqual(['tavily', 'brave', 'metaso'])
  })
})

describe('evaluateSearchEscalation', () => {
  const plan = {
    queryPlans: [
      { query: 'q', queryLanguage: 'zh' as const, engines: ['metaso', 'tavily'] },
    ],
    fallbackEngines: ['brave'],
    primaryLanguage: 'zh' as const,
    highRisk: false,
    requiredSources: 2,
  }

  it('escalates when successful sources are insufficient', () => {
    const result: WebSearchParallelResult = {
      hits: [],
      tasks: [
        {
          task: {
            engine: 'metaso',
            query: 'q',
            queryLanguage: 'zh',
            queryIndex: 0,
            taskIndex: 0,
          },
          status: 'success',
          hits: [],
        },
      ],
    }

    const decision = evaluateSearchEscalation(plan, result)
    expect(decision.escalate).toBe(true)
    expect(decision.reason).toBe('insufficient_sources')
  })

  it('escalates when overlap between engines is too low', () => {
    const result: WebSearchParallelResult = {
      hits: [
        { title: 'A', url: 'https://a.test', sourceEngines: ['metaso'] },
        { title: 'B', url: 'https://b.test', sourceEngines: ['tavily'] },
      ],
      tasks: [
        {
          task: {
            engine: 'metaso',
            query: 'q',
            queryLanguage: 'zh',
            queryIndex: 0,
            taskIndex: 0,
          },
          status: 'success',
          hits: [],
        },
        {
          task: {
            engine: 'tavily',
            query: 'q',
            queryLanguage: 'zh',
            queryIndex: 0,
            taskIndex: 1,
          },
          status: 'success',
          hits: [],
        },
      ],
    }

    const decision = evaluateSearchEscalation(plan, result)
    expect(decision.escalate).toBe(true)
    expect(decision.reason).toBe('low_overlap')
  })
})
