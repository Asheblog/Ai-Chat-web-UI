/**
 * 启用引擎列表就是唯一真源：数组顺序 = 并行调度与融合权重优先级。
 * 不再有独立的 engine_order 键，也没有第二个融合策略/双语布尔开关。
 */

import { buildAgentWebSearchConfig } from '../agent-tool-config'

describe('buildAgentWebSearchConfig 引擎顺序', () => {
  it('启用引擎的数组顺序直接决定优先级', () => {
    const config = buildAgentWebSearchConfig(
      { web_search_enabled_engines: 'brave, tavily' },
      {},
    )

    expect(config.engines).toEqual(['brave', 'tavily'])
  })

  it('忽略历史遗留的 web_search_engine_order 键', () => {
    const config = buildAgentWebSearchConfig(
      { web_search_enabled_engines: 'brave,tavily', web_search_engine_order: 'tavily,brave' },
      {},
    )

    expect(config.engines).toEqual(['brave', 'tavily'])
  })

  it('去重并过滤未知引擎，保留首次出现的位置', () => {
    const config = buildAgentWebSearchConfig(
      { web_search_enabled_engines: 'exa, tavily, exa, unknown-engine, metaso' },
      {},
    )

    expect(config.engines).toEqual(['exa', 'tavily', 'metaso'])
  })

  it('配置里不再暴露引擎顺序、融合策略与双语布尔开关', () => {
    const config = buildAgentWebSearchConfig({}, {})

    expect(config).not.toHaveProperty('engineOrder')
    expect(config).not.toHaveProperty('mergeStrategy')
    expect(config).not.toHaveProperty('autoBilingual')
  })

  it('双语只由三态模式承载', () => {
    expect(buildAgentWebSearchConfig({}, {}).autoBilingualMode).toBe('conditional')
    expect(
      buildAgentWebSearchConfig({ web_search_auto_bilingual_mode: 'off' }, {}).autoBilingualMode,
    ).toBe('off')
    expect(
      buildAgentWebSearchConfig({ web_search_auto_bilingual_mode: 'always' }, {}).autoBilingualMode,
    ).toBe('always')
  })
})
