import { resolveModelCapabilitiesForSession } from '../model-capabilities'

const prisma = {
  modelCatalog: {
    findFirst: jest.fn(),
  },
} as any

describe('resolveModelCapabilitiesForSession', () => {
  it('returns capabilitiesJson flags when stored', async () => {
    prisma.modelCatalog.findFirst.mockResolvedValue({
      capabilitiesJson: JSON.stringify({ vision: false, image_generation: true }),
      tagsJson: '[]',
    })
    const flags = await resolveModelCapabilitiesForSession(prisma, { connectionId: 1, modelRawId: 'gpt-4o' })
    expect(flags).toEqual({ vision: false, image_generation: true })
  })

  it('falls back to heuristics when no stored capabilities', async () => {
    prisma.modelCatalog.findFirst.mockResolvedValue(null)
    const flags = await resolveModelCapabilitiesForSession(prisma, { connectionId: 1, modelRawId: 'qwen-vl-max' })
    expect(flags.vision).toBe(true)
  })

  it('returns empty flags when session has no connection', async () => {
    const flags = await resolveModelCapabilitiesForSession(prisma, { connectionId: null, modelRawId: '' })
    expect(flags.vision).toBeUndefined()
  })
})
