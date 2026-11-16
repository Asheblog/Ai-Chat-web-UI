import { SystemSettingsService } from './system-settings-service'

const service = (record: { value: string } | null) =>
  new SystemSettingsService({
    prisma: {
      systemSetting: {
        findUnique: jest.fn().mockResolvedValue(record),
      },
    } as any,
  })

describe('SystemSettingsService.getReasoningMaxOutputTokensDefault', () => {
  const original = process.env.REASONING_MAX_OUTPUT_TOKENS_DEFAULT

  afterEach(() => {
    if (original === undefined) delete process.env.REASONING_MAX_OUTPUT_TOKENS_DEFAULT
    else process.env.REASONING_MAX_OUTPUT_TOKENS_DEFAULT = original
  })

  it('returns 0 (auto) when nothing is configured', async () => {
    delete process.env.REASONING_MAX_OUTPUT_TOKENS_DEFAULT
    expect(await service(null).getReasoningMaxOutputTokensDefault()).toBe(0)
  })

  it('keeps an explicit value', async () => {
    expect(await service({ value: '32000' }).getReasoningMaxOutputTokensDefault()).toBe(32000)
  })

  it('falls back to auto instead of a hardcoded ceiling', async () => {
    expect(await service({ value: '0' }).getReasoningMaxOutputTokensDefault()).toBe(0)
  })
})
