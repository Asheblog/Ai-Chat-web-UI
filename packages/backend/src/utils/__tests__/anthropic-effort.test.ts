import { resolveAnthropicEffort, resolveAnthropicEffortSupport } from '../anthropic-effort'

describe('resolveAnthropicEffortSupport', () => {
  it('exposes low/medium/high/max but not xhigh on Opus 4.6', () => {
    expect(resolveAnthropicEffortSupport('claude-opus-4-6')).toEqual({
      supported: true,
      efforts: ['low', 'medium', 'high', 'max'],
    })
  })

  it('exposes all five levels on Opus 4.7 and Opus 5.5', () => {
    expect(resolveAnthropicEffortSupport('claude-opus-4-7').efforts).toEqual([
      'low', 'medium', 'high', 'xhigh', 'max',
    ])
    expect(resolveAnthropicEffortSupport('claude-opus-5-5').efforts).toEqual([
      'low', 'medium', 'high', 'xhigh', 'max',
    ])
  })

  it('limits the only supported Opus 4.5 snapshot to low/medium/high', () => {
    expect(resolveAnthropicEffortSupport('claude-opus-4-5-20251101')).toEqual({
      supported: true,
      efforts: ['low', 'medium', 'high'],
    })
    expect(resolveAnthropicEffortSupport('claude-opus-4-5-20250929').supported).toBe(false)
  })

  it('does not offer effort on models outside the official list', () => {
    for (const model of ['claude-sonnet-4-5', 'claude-haiku-4-5-20251001', 'claude-3-7-sonnet-latest', 'unknown-model']) {
      expect(resolveAnthropicEffortSupport(model)).toEqual({ supported: false, efforts: [] })
    }
  })

  it('keeps max but not xhigh for Mythos Preview', () => {
    expect(resolveAnthropicEffortSupport('claude-mythos-preview').efforts).toEqual([
      'low', 'medium', 'high', 'max',
    ])
  })

  it('matches prefixed display ids and dated snapshots of a supported family', () => {
    expect(resolveAnthropicEffortSupport('prod.claude-opus-5-5').supported).toBe(true)
    expect(resolveAnthropicEffortSupport('claude-opus-5-5-20260101').supported).toBe(true)
  })
})

describe('resolveAnthropicEffort', () => {
  it('sends nothing for models without effort support', () => {
    expect(resolveAnthropicEffort('claude-sonnet-4-5', 'high')).toBeNull()
  })

  it('drops levels the target model does not expose', () => {
    expect(resolveAnthropicEffort('claude-opus-4-6', 'xhigh')).toBeNull()
    expect(resolveAnthropicEffort('claude-opus-4-6', 'max')).toBe('max')
    expect(resolveAnthropicEffort('claude-opus-4-5-20251101', 'max')).toBeNull()
  })

  it('maps minimal to low only where low is supported', () => {
    expect(resolveAnthropicEffort('claude-opus-4-5-20251101', 'minimal')).toBe('low')
    expect(resolveAnthropicEffort('claude-sonnet-4-5', 'minimal')).toBeNull()
  })

  it('treats none and empty values as no effort', () => {
    expect(resolveAnthropicEffort('claude-opus-5-5', 'none')).toBeNull()
    expect(resolveAnthropicEffort('claude-opus-5-5', '')).toBeNull()
    expect(resolveAnthropicEffort('claude-opus-5-5', 'unset')).toBeNull()
  })
})
