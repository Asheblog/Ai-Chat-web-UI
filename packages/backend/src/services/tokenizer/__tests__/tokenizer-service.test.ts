import { TokenizerService } from '../tokenizer-service'

describe('TokenizerService', () => {
  test('uses encoder when available', async () => {
    const mockEncoder = { encode: (t: string) => Array.from({ length: t.length }, (_, i) => i) }
    const service = new TokenizerService({ encoderFactory: async () => mockEncoder })
    const tokens = await service.countTokens('abcd')
    expect(tokens).toBe(4)
  })

  test('falls back when encoder fails', async () => {
    const service = new TokenizerService({
      encoderFactory: async () => {
        throw new Error('boom')
      },
    })
    const tokens = await service.countTokens('abcd')
    // ascii: 4/4=1 token
    expect(tokens).toBe(1)
  })

  test('counts message and conversation tokens', async () => {
    const mockEncoder = { encode: (t: string) => Array.from({ length: t.length }, (_, i) => i) }
    const service = new TokenizerService({ encoderFactory: async () => mockEncoder })
    const msgTokens = await service.countMessageTokens('user', 'hi')
    expect(msgTokens).toBeGreaterThan(0)
    const convTokens = await service.countConversationTokens([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ])
    expect(convTokens).toBeGreaterThan(msgTokens)
  })

  test('truncates messages based on max tokens', async () => {
    const mockEncoder = { encode: (t: string) => Array.from({ length: t.length }, (_, i) => i) }
    const service = new TokenizerService({ encoderFactory: async () => mockEncoder })
    const messages = [
      { role: 'user', content: 'short' },
      { role: 'assistant', content: 'response' },
      { role: 'user', content: 'another short message' },
    ]
    const truncated = await service.truncateMessages(messages, 40)
    expect(truncated.length).toBeGreaterThan(0)
    expect(truncated.length).toBeLessThanOrEqual(messages.length)
  })
})
