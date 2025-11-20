import { ContextWindowService } from '../context-window-service'

const createMockPrisma = (metaJson?: string | null) => ({
  modelCatalog: {
    findFirst: jest.fn().mockResolvedValue(metaJson ? { metaJson } : null),
  },
})

describe('ContextWindowService', () => {
  test('uses catalog meta for context limit', async () => {
    const prisma = createMockPrisma(JSON.stringify({ context_window: 20000 }))
    const svc = new ContextWindowService({
      prisma: prisma as any,
      getSystemContextTokenLimit: async () => 1000,
    })
    const value = await svc.resolveContextLimit({ connectionId: 1, rawModelId: 'x' })
    expect(value).toBe(20000)
  })

  test('guesses context limit when no meta', async () => {
    const prisma = createMockPrisma(null)
    const svc = new ContextWindowService({
      prisma: prisma as any,
      getSystemContextTokenLimit: async () => 1234,
    })
    const value = await svc.resolveContextLimit({ provider: 'openai', rawModelId: 'gpt-4o' })
    expect(value).toBeGreaterThan(1000)
  })

  test('falls back to system default when no match', async () => {
    const prisma = createMockPrisma(null)
    const svc = new ContextWindowService({
      prisma: prisma as any,
      getSystemContextTokenLimit: async () => 777,
    })
    const value = await svc.resolveContextLimit({ rawModelId: 'unknown' })
    expect(value).toBe(777)
  })

  test('uses meta for completion limit then cache', async () => {
    const prisma = createMockPrisma(JSON.stringify({ max_output_tokens: 5000 }))
    const svc = new ContextWindowService({
      prisma: prisma as any,
      getReasoningMaxOutputTokensDefault: async () => 32000,
      now: () => 0,
      cacheTtlMs: 1000,
    })
    const value = await svc.resolveCompletionLimit({ connectionId: 1, rawModelId: 'x' })
    expect(value).toBe(5000)
    // ensure cache hit
    prisma.modelCatalog.findFirst.mockResolvedValue({ metaJson: JSON.stringify({ max_output_tokens: 1 }) })
    const value2 = await svc.resolveCompletionLimit({ connectionId: 1, rawModelId: 'x' })
    expect(value2).toBe(5000)
    svc.invalidateCompletionLimitCache(1, 'x')
    const value3 = await svc.resolveCompletionLimit({ connectionId: 1, rawModelId: 'x' })
    expect(value3).toBe(1)
  })

  test('guesses completion limit when meta missing', async () => {
    const prisma = createMockPrisma(null)
    const svc = new ContextWindowService({
      prisma: prisma as any,
      getReasoningMaxOutputTokensDefault: async () => 32000,
    })
    const value = await svc.resolveCompletionLimit({ provider: 'openai', rawModelId: 'deepseek-chat' })
    expect(value).toBe(4096)
  })
})
