import {
  resolveEffortForModel,
  resolveSupportedEfforts,
  shouldSendTemperature,
} from '../model-generation-parameters'

describe('resolveSupportedEfforts', () => {
  it('uses the documented enum per protocol', () => {
    expect(resolveSupportedEfforts({ provider: 'openai' })).toEqual([
      'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
    ])
    expect(resolveSupportedEfforts({ provider: 'anthropic', rawModelId: 'claude-opus-5-5' })).toEqual([
      'low', 'medium', 'high', 'xhigh', 'max',
    ])
    expect(resolveSupportedEfforts({ provider: 'anthropic', rawModelId: 'claude-sonnet-4-5' })).toEqual([])
    expect(resolveSupportedEfforts({ provider: 'google_genai' })).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh'])
    expect(resolveSupportedEfforts({ provider: 'openai', thinkingDialect: 'deepseek_compat' })).toEqual(['low', 'high', 'max'])
  })
})

describe('resolveEffortForModel', () => {
  it('sends nothing for Auto', () => {
    expect(resolveEffortForModel({ provider: 'openai' }, '')).toBeNull()
    expect(resolveEffortForModel({ provider: 'openai' }, 'unset')).toBeNull()
    expect(resolveEffortForModel({ provider: 'openai' }, null)).toBeNull()
  })

  it('passes through supported values', () => {
    expect(resolveEffortForModel({ provider: 'openai' }, 'high')).toBe('high')
    expect(resolveEffortForModel({ provider: 'anthropic', rawModelId: 'claude-opus-5-5' }, 'xhigh')).toBe('xhigh')
  })

  it('maps aliases the protocol documents', () => {
    expect(resolveEffortForModel({ provider: 'openai', thinkingDialect: 'deepseek_compat' }, 'medium')).toBe('high')
    expect(resolveEffortForModel({ provider: 'openai', thinkingDialect: 'deepseek_compat' }, 'xhigh')).toBe('high')
    expect(resolveEffortForModel({ provider: 'anthropic', rawModelId: 'claude-opus-5-5' }, 'minimal')).toBe('low')
    expect(resolveEffortForModel({ provider: 'google_genai' }, 'max')).toBe('xhigh')
  })

  it('drops values with no protocol equivalent instead of sending them', () => {
    expect(resolveEffortForModel({ provider: 'anthropic', rawModelId: 'claude-opus-5-5' }, 'none')).toBeNull()
    expect(resolveEffortForModel({ provider: 'google_genai' }, 'none')).toBeNull()
    expect(resolveEffortForModel({ provider: 'openai' }, 'ultra')).toBeNull()
  })
})

describe('shouldSendTemperature', () => {
  it('skips temperature in DeepSeek thinking mode because the vendor ignores it', () => {
    expect(shouldSendTemperature({ provider: 'openai', thinkingDialect: 'deepseek_compat', reasoningEnabled: true })).toBe(false)
    expect(shouldSendTemperature({ provider: 'openai', thinkingDialect: 'deepseek_compat', reasoningEnabled: false })).toBe(true)
  })

  it('keeps temperature for protocols without that restriction', () => {
    expect(shouldSendTemperature({ provider: 'openai', reasoningEnabled: true })).toBe(true)
    expect(shouldSendTemperature({ provider: 'anthropic', reasoningEnabled: true })).toBe(true)
  })
})
