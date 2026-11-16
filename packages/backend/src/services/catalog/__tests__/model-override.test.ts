import {
  clearModelOverrides,
  readModelOverrideState,
  readModelContextWindow,
  readModelMaxOutputTokens,
  setModelParameterOverride,
  promoteLegacyContextOverride,
  type ModelOverrideRow,
} from '../model-override'

const row = (overrides: Partial<ModelOverrideRow> = {}): ModelOverrideRow => ({
  capabilitiesJson: '{}',
  metaJson: '{}',
  manualOverride: false,
  ...overrides,
})

describe('readModelOverrideState', () => {
  it('does not treat an access-policy-only row as a capability override', () => {
    const state = readModelOverrideState(row({
      manualOverride: true,
      metaJson: JSON.stringify({ access_policy: { user: 'allow' } }),
    }))
    expect(state).toEqual({ capabilities: false, parameters: false, access: true, any: true })
  })

  it('detects manual capabilities from the stored envelope source', () => {
    const state = readModelOverrideState(row({
      manualOverride: true,
      capabilitiesJson: JSON.stringify({ flags: { vision: true }, source: 'manual' }),
    }))
    expect(state.capabilities).toBe(true)
    expect(state.parameters).toBe(false)
    expect(state.access).toBe(false)
  })

  it('treats a legacy bare-flag row as manual capabilities', () => {
    const state = readModelOverrideState(row({
      manualOverride: true,
      capabilitiesJson: JSON.stringify({ vision: true }),
    }))
    expect(state.capabilities).toBe(true)
  })

  it('ignores detected capability envelopes', () => {
    const state = readModelOverrideState(row({
      capabilitiesJson: JSON.stringify({ flags: { vision: true }, source: 'heuristic' }),
    }))
    expect(state.capabilities).toBe(false)
    expect(state.any).toBe(false)
  })

  it('detects parameter overrides written as custom keys only', () => {
    const state = readModelOverrideState(row({
      metaJson: JSON.stringify({ context_window: 128000, max_output_tokens: 4096, fetched_at: 'x' }),
    }))
    expect(state.parameters).toBe(false)
    expect(state.any).toBe(false)
    const manual = readModelOverrideState(row({
      metaJson: JSON.stringify({ custom_context_window: 64000, temperature: 0.2 }),
    }))
    expect(manual.parameters).toBe(true)
  })
})

describe('parameter precedence', () => {
  it('prefers the manual context window over the detected value', () => {
    const meta = { context_window: 32000, custom_context_window: 128000 }
    expect(readModelContextWindow(meta)).toBe(128000)
    expect(readModelContextWindow({ context_window: 32000 })).toBe(32000)
    expect(readModelContextWindow({})).toBeNull()
  })

  it('prefers the manual generation limit over the detected value', () => {
    expect(readModelMaxOutputTokens({ max_output_tokens: 8192, custom_max_output_tokens: 2048 })).toBe(2048)
    expect(readModelMaxOutputTokens({ max_output_tokens: 8192 })).toBe(8192)
  })
})

describe('setModelParameterOverride', () => {
  it('writes manual parameters without touching detected keys', () => {
    const meta = setModelParameterOverride({ context_window: 32000 }, { contextWindow: 128000 })
    expect(meta.custom_context_window).toBe(128000)
    expect(meta.context_window).toBe(32000)
  })

  it('clears a manual parameter on null', () => {
    const meta = setModelParameterOverride(
      { custom_context_window: 128000, custom_max_output_tokens: 2048, temperature: 0.5 },
      { contextWindow: null, maxOutputTokens: null },
    )
    expect(meta.custom_context_window).toBeUndefined()
    expect(meta.custom_max_output_tokens).toBeUndefined()
    expect(meta.temperature).toBe(0.5)
  })
})

describe('clearModelOverrides', () => {
  it('clears only the requested scope and keeps the other overrides', () => {
    const cleared = clearModelOverrides(row({
      manualOverride: true,
      capabilitiesJson: JSON.stringify({ flags: { vision: true }, source: 'manual' }),
      metaJson: JSON.stringify({ access_policy: { user: 'allow' }, temperature: 0.3, custom_max_output_tokens: 2048 }),
    }), ['parameters'])
    expect(JSON.parse(cleared.capabilitiesJson!)).toEqual({ flags: { vision: true }, source: 'manual' })
    const meta = JSON.parse(cleared.metaJson)
    expect(meta.temperature).toBeUndefined()
    expect(meta.custom_max_output_tokens).toBeUndefined()
    expect(meta.access_policy).toEqual({ user: 'allow' })
    expect(cleared.state).toEqual({ capabilities: true, parameters: false, access: true, any: true })
  })

  it('reports no remaining overrides after clearing every scope', () => {
    const cleared = clearModelOverrides(row({
      manualOverride: true,
      capabilitiesJson: JSON.stringify({ flags: { vision: true }, source: 'manual' }),
      metaJson: JSON.stringify({ access_policy: { user: 'deny' }, custom_context_window: 64000 }),
    }), ['capabilities', 'parameters', 'access'])
    expect(cleared.state).toEqual({ capabilities: false, parameters: false, access: false, any: false })
  })
})

describe('promoteLegacyContextOverride', () => {
  it('turns a legacy manual context window into the manual key once', () => {
    const meta = promoteLegacyContextOverride({ context_window: 64000 }, true)
    expect(meta.custom_context_window).toBe(64000)
  })

  it('leaves detected rows untouched', () => {
    const meta = promoteLegacyContextOverride({ context_window: 64000 }, false)
    expect(meta.custom_context_window).toBeUndefined()
  })

  it('is idempotent when the manual key already exists', () => {
    const meta = promoteLegacyContextOverride({ context_window: 32000, custom_context_window: 64000 }, true)
    expect(meta.custom_context_window).toBe(64000)
  })
})
