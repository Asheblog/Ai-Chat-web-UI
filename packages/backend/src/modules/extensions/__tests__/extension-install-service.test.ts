jest.mock('../github-probe', () => ({
  probeRepository: jest.fn().mockResolvedValue({
    files: {
      'SKILL.md': '---\nname: Demo Skill\n---',
    },
    skipped: [],
    ref: 'main',
  }),
}))

import { ExtensionInstallService } from '../extension-install-service'

const buildService = (role: string, status = 'ACTIVE') => {
  const install = jest.fn().mockResolvedValue({ ok: true, status: 'ready' })
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ role, status }) },
  }
  const service = new ExtensionInstallService({
    prisma: prisma as any,
    installer: { install } as any,
  })
  return { service, install }
}

describe('ExtensionInstallService · 权限与默认范围', () => {
  it('admin without explicit scope installs a system-level template', async () => {
    const { service, install } = buildService('ADMIN')
    const outcome = await service.installFromSource({
      source: 'acme/demo',
      actorUserId: 1,
      sessionId: 42,
    })
    expect(outcome.ok).toBe(true)
    expect(install).toHaveBeenCalledWith(expect.objectContaining({ scope: 'system', actorIsAdmin: true }))
  })

  it('regular user without explicit scope installs privately', async () => {
    const { service, install } = buildService('USER')
    await service.installFromSource({ source: 'acme/demo', actorUserId: 2 })
    expect(install).toHaveBeenCalledWith(expect.objectContaining({ scope: 'user', actorIsAdmin: false }))
  })

  it('rejects pending accounts before touching the repository', async () => {
    const { service, install } = buildService('USER', 'PENDING')
    const outcome = await service.installFromSource({ source: 'acme/demo', actorUserId: 3 })
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toContain('当前账号不可用')
    expect(install).not.toHaveBeenCalled()
  })

  it('blocks non-admins from forcing system scope', async () => {
    const { service, install } = buildService('USER')
    const outcome = await service.installFromSource({
      source: 'acme/demo',
      scope: 'system',
      actorUserId: 4,
    })
    expect(outcome.ok).toBe(false)
    expect(install).not.toHaveBeenCalled()
  })
})
