import type { Request } from 'undici'
import { PersonalSettingsError, PersonalSettingsService } from './personal-settings-service'

const buildRequest = (): Request => new Request('http://localhost')

const buildService = () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  }
  const replaceProfileImage = jest.fn(async () => '/avatar/new.png')
  const resolveProfileImageUrl = jest.fn((path: string | null, base: string) =>
    path ? `${base}${path}` : null,
  )
  const determineProfileImageBaseUrl = jest.fn(() => 'http://cdn/')

  const service = new PersonalSettingsService({
    prisma: prisma as any,
    replaceProfileImage,
    resolveProfileImageUrl,
    determineProfileImageBaseUrl,
  })

  return {
    prisma,
    replaceProfileImage,
    resolveProfileImageUrl,
    determineProfileImageBaseUrl,
    service,
  }
}

describe('PersonalSettingsService', () => {
  it('returns personal settings with defaults', async () => {
    const { prisma, service, determineProfileImageBaseUrl, resolveProfileImageUrl } =
      buildService()
    prisma.user.findUnique.mockResolvedValueOnce({
      username: 'admin',
      preferredModelId: 'm1',
      preferredConnectionId: 2,
      preferredModelRawId: 'raw1',
      avatarPath: '/avatar/a.png',
      personalPrompt: 'keep calm',
    })
    const result = await service.getPersonalSettings({ userId: 1, request: buildRequest() })
    expect(determineProfileImageBaseUrl).toHaveBeenCalled()
    expect(resolveProfileImageUrl).toHaveBeenCalledWith('/avatar/a.png', 'http://cdn/')
    expect(result.preferred_model).toEqual({
      modelId: 'm1',
      connectionId: 2,
      rawId: 'raw1',
    })
    expect(result.personal_prompt).toBe('keep calm')
  })

  it('updates preferred model and avatar when provided', async () => {
    const { prisma, service, replaceProfileImage } = buildService()
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 5,
      username: 'old_admin',
      preferredModelId: null,
      preferredConnectionId: null,
      preferredModelRawId: null,
      avatarPath: '/avatar/old.png',
      personalPrompt: null,
    })
    prisma.user.findUnique.mockResolvedValueOnce(null)
    prisma.user.update.mockResolvedValueOnce({})

    const result = await service.updatePersonalSettings({
      userId: 5,
      request: buildRequest(),
      payload: {
        preferred_model: { modelId: 'm2', connectionId: 3, rawId: 'raw2' },
        avatar: { data: 'base64', mime: 'image/png' },
        username: 'new_admin',
        personal_prompt: ' make things short ',
      },
    })

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: {
        preferredModelId: 'm2',
        preferredConnectionId: 3,
        preferredModelRawId: 'raw2',
        avatarPath: '/avatar/new.png',
        username: 'new_admin',
        personalPrompt: 'make things short',
      },
    })
    expect(replaceProfileImage).toHaveBeenCalled()
    expect(result.preferred_model.modelId).toBe('m2')
    expect(result.avatar_url).toContain('/avatar/new.png')
    expect(result.username).toBe('new_admin')
    expect(result.personal_prompt).toBe('make things short')
  })

  it('skips update when no fields change', async () => {
    const { prisma, service } = buildService()
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 6,
      username: 'existing',
      preferredModelId: 'm3',
      preferredConnectionId: 4,
      preferredModelRawId: 'raw4',
      avatarPath: '/avatar/existing.png',
      personalPrompt: 'stay friendly',
    })
    const result = await service.updatePersonalSettings({
      userId: 6,
      request: buildRequest(),
      payload: {},
    })
    expect(prisma.user.update).not.toHaveBeenCalled()
    expect(result.preferred_model.connectionId).toBe(4)
    expect(result.personal_prompt).toBe('stay friendly')
  })

  it('defaults context_enabled to true when the column has no value', async () => {
    const { prisma, service } = buildService()
    prisma.user.findUnique.mockResolvedValueOnce({
      username: 'admin',
      preferredModelId: null,
      preferredConnectionId: null,
      preferredModelRawId: null,
      avatarPath: null,
      personalPrompt: null,
    })
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 9,
      username: 'admin',
      preferredModelId: null,
      preferredConnectionId: null,
      preferredModelRawId: null,
      avatarPath: null,
      personalPrompt: null,
      contextEnabled: null,
    })

    const settings = await service.getPersonalSettings({ userId: 9, request: buildRequest() })
    expect(settings.context_enabled).toBe(true)

    const updated = await service.updatePersonalSettings({
      userId: 9,
      request: buildRequest(),
      payload: {},
    })
    expect(prisma.user.update).not.toHaveBeenCalled()
    expect(updated.context_enabled).toBe(true)
  })

  it('persists an explicit context_enabled false', async () => {
    const { prisma, service } = buildService()
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 10,
      username: 'quiet_user',
      preferredModelId: null,
      preferredConnectionId: null,
      preferredModelRawId: null,
      avatarPath: null,
      personalPrompt: null,
      contextEnabled: true,
    })
    prisma.user.update.mockResolvedValueOnce({})

    const result = await service.updatePersonalSettings({
      userId: 10,
      request: buildRequest(),
      payload: { context_enabled: false },
    })

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { contextEnabled: false },
    })
    expect(result.context_enabled).toBe(false)
  })

  it('reads back the persisted context_enabled value', async () => {
    const { prisma, service } = buildService()
    prisma.user.findUnique.mockResolvedValue({
      id: 11,
      username: 'quiet_user',
      preferredModelId: null,
      preferredConnectionId: null,
      preferredModelRawId: null,
      avatarPath: null,
      personalPrompt: null,
      contextEnabled: false,
    })
    prisma.user.update.mockResolvedValueOnce({})

    const settings = await service.getPersonalSettings({ userId: 11, request: buildRequest() })
    expect(settings.context_enabled).toBe(false)

    const updated = await service.updatePersonalSettings({
      userId: 11,
      request: buildRequest(),
      payload: { personal_prompt: 'be brief' },
    })
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: { personalPrompt: 'be brief' },
    })
    expect(updated.context_enabled).toBe(false)
  })

  it('rejects duplicate usernames', async () => {
    const { prisma, service } = buildService()
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 7,
      username: 'admin',
      preferredModelId: null,
      preferredConnectionId: null,
      preferredModelRawId: null,
      avatarPath: null,
    })
    prisma.user.findUnique.mockResolvedValueOnce({ id: 8 })

    await expect(
      service.updatePersonalSettings({
        userId: 7,
        request: buildRequest(),
        payload: { username: 'taken_name' },
      }),
    ).rejects.toBeInstanceOf(PersonalSettingsError)
  })
})
