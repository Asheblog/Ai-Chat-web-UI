import {
  detectChatReasoningSignal,
  isResponsesUnsupportedFallback,
} from './reasoning-protocol-utils'

describe('reasoning protocol utils', () => {
  it('detects OpenAI chat completion reasoning deltas', () => {
    expect(detectChatReasoningSignal({ choices: [{ delta: { reasoning_content: 'x' } }] })).toBe(
      'delta.reasoning_content',
    )
  })

  it('returns null when no reasoning signal is present', () => {
    expect(detectChatReasoningSignal({ choices: [{ delta: { content: 'x' } }] })).toBeNull()
  })

  it('detects unsupported /responses endpoint fallbacks', () => {
    expect(isResponsesUnsupportedFallback(404, 'not found')).toBe(true)
    expect(isResponsesUnsupportedFallback(400, 'unknown endpoint /responses')).toBe(true)
    expect(isResponsesUnsupportedFallback(400, 'bad request')).toBe(false)
  })
})
