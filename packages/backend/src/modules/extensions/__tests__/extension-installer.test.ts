import { ExtensionInstaller } from '../extension-installer'
import type { InstallPlan } from '../types'

const mcpPlan: InstallPlan = {
  kind: 'mcp',
  name: 'demo-mcp',
  slug: 'demo-mcp',
  confidence: 'high',
  reason: '识别到远程 MCP 端点',
  source: { owner: 'acme', repo: 'demo', raw: 'acme/demo' },
  sourceUrl: 'https://github.com/acme/demo',
  sourceType: 'remote',
  transport: 'streamable_http',
  endpoint: 'https://mcp.acme.dev/mcp',
  envKeys: [{ name: 'ACME_TOKEN', reason: 'README 提到的配置项' }],
}

const buildMcpService = (overrides: Record<string, unknown> = {}) => ({
  findInstallationByKey: jest.fn().mockResolvedValue(null),
  listConnections: jest.fn().mockResolvedValue([]),
  createInstallation: jest.fn().mockResolvedValue({ id: 11, namespaceKey: 'acme/demo' }),
  createConnection: jest.fn().mockResolvedValue({ id: 22 }),
  bindConnection: jest.fn().mockResolvedValue({ id: 1 }),
  refreshToolCache: jest.fn().mockResolvedValue(2),
  listToolCache: jest.fn().mockResolvedValue([
    { originalName: 'search', description: 'search docs' },
    { originalName: 'fetch', description: null },
  ]),
  pinTool: jest.fn().mockResolvedValue({}),
  deleteConnection: jest.fn().mockResolvedValue(undefined),
  deleteInstallation: jest.fn().mockResolvedValue(undefined),
  ...overrides,
})

const baseInput = {
  plan: mcpPlan,
  actorUserId: 7,
  actorIsAdmin: true,
  scope: 'user' as const,
  enable: true,
  sessionId: 42,
}

describe('ExtensionInstaller · MCP', () => {
  it('creates installation, connection, bindings and verifies tools', async () => {
    const mcpService = buildMcpService()
    const installer = new ExtensionInstaller({ prisma: {} as any, mcpService: mcpService as any })

    const outcome = await installer.install(baseInput)

    expect(outcome.status).toBe('ready')
    expect(outcome.installed).toEqual({ installationId: 11, connectionId: 22 })
    expect(outcome.tools).toHaveLength(2)
    expect(mcpService.createInstallation).toHaveBeenCalledWith(
      expect.objectContaining({
        namespaceKey: 'acme/demo',
        sourceType: 'remote',
        argsJson: '[]',
        envJson: JSON.stringify({ requiredEnv: ['ACME_TOKEN'] }),
      }),
      true,
    )
    expect(mcpService.bindConnection).toHaveBeenCalledWith(
      expect.objectContaining({ scopeType: 'user', scopeId: '7' }),
    )
    expect(mcpService.bindConnection).toHaveBeenCalledWith(
      expect.objectContaining({ scopeType: 'session', scopeId: '42' }),
    )
    expect(mcpService.pinTool).toHaveBeenCalledTimes(2)
  })

  it('returns already_installed for a repeat install by the same owner', async () => {
    const mcpService = buildMcpService({
      findInstallationByKey: jest.fn().mockResolvedValue({ id: 11 }),
      listConnections: jest.fn().mockResolvedValue([{ id: 22, ownerUserId: 7 }]),
    })
    const installer = new ExtensionInstaller({ prisma: {} as any, mcpService: mcpService as any })

    const outcome = await installer.install(baseInput)

    expect(outcome.status).toBe('already_installed')
    expect(mcpService.createInstallation).not.toHaveBeenCalled()
    expect(mcpService.createConnection).not.toHaveBeenCalled()
  })

  it('blocks non-admin users from creating an installation template', async () => {
    const mcpService = buildMcpService()
    const installer = new ExtensionInstaller({ prisma: {} as any, mcpService: mcpService as any })

    const outcome = await installer.install({ ...baseInput, actorIsAdmin: false })

    expect(outcome.ok).toBe(false)
    expect(outcome.status).toBe('pending_approval')
    expect(mcpService.createInstallation).not.toHaveBeenCalled()
  })

  it('blocks non-admin users from local package servers', async () => {
    const mcpService = buildMcpService()
    const installer = new ExtensionInstaller({ prisma: {} as any, mcpService: mcpService as any })

    const outcome = await installer.install({
      ...baseInput,
      actorIsAdmin: false,
      plan: { ...mcpPlan, sourceType: 'local_package', transport: 'stdio', command: 'npx', args: ['-y', 'x'], endpoint: undefined },
    })

    expect(outcome.status).toBe('pending_gateway')
    expect(mcpService.createInstallation).not.toHaveBeenCalled()
  })

  it('reports needs_secret when verification fails and env keys are declared', async () => {
    const mcpService = buildMcpService({
      refreshToolCache: jest.fn().mockRejectedValue(new Error('401 unauthorized')),
    })
    const installer = new ExtensionInstaller({ prisma: {} as any, mcpService: mcpService as any })

    const outcome = await installer.install(baseInput)

    expect(outcome.ok).toBe(true)
    expect(outcome.status).toBe('needs_secret')
    expect(outcome.requiredSecrets?.[0]?.name).toBe('ACME_TOKEN')
  })

  it('reports pending_gateway when the container gateway is unavailable', async () => {
    const gatewayError = Object.assign(new Error('未安装 docker'), { code: 'MCP_GATEWAY_UNAVAILABLE' })
    const mcpService = buildMcpService({
      refreshToolCache: jest.fn().mockRejectedValue(gatewayError),
    })
    const installer = new ExtensionInstaller({ prisma: {} as any, mcpService: mcpService as any })

    const outcome = await installer.install(baseInput)

    expect(outcome.status).toBe('pending_gateway')
  })

  it('rolls back both records when connection creation fails', async () => {
    const mcpService = buildMcpService({
      createConnection: jest.fn().mockRejectedValue(new Error('db down')),
    })
    const installer = new ExtensionInstaller({ prisma: {} as any, mcpService: mcpService as any })

    const outcome = await installer.install(baseInput)

    expect(outcome.ok).toBe(false)
    expect(mcpService.deleteConnection).not.toHaveBeenCalled()
    expect(mcpService.deleteInstallation).toHaveBeenCalledWith(11)
  })

  it('keeps the shared template when rollback happens on an existing installation', async () => {
    const mcpService = buildMcpService({
      findInstallationByKey: jest.fn().mockResolvedValue({ id: 11 }),
      createConnection: jest.fn().mockRejectedValue(new Error('boom')),
    })
    const installer = new ExtensionInstaller({ prisma: {} as any, mcpService: mcpService as any })

    await installer.install({ ...baseInput, actorIsAdmin: false })

    expect(mcpService.createInstallation).not.toHaveBeenCalled()
    expect(mcpService.deleteInstallation).not.toHaveBeenCalled()
  })
})

describe('ExtensionInstaller · Skill', () => {
  const skillPlan: InstallPlan = {
    kind: 'skill',
    name: 'PDF Helper',
    slug: 'pdf-helper',
    confidence: 'high',
    reason: '找到 SKILL.md',
    source: { owner: 'acme', repo: 'demo', ref: 'main', subdir: 'skills/pdf', raw: 'acme/demo' },
    sourceUrl: 'https://github.com/acme/demo/tree/main/skills/pdf',
    subdir: 'skills/pdf',
  }

  it('binds an active skill version to the current session', async () => {
    const upsert = jest.fn().mockResolvedValue({})
    const skillInstaller = {
      installFromGithub: jest.fn().mockResolvedValue({
        skill: { id: 5, slug: 'pdf-helper', displayName: 'PDF Helper', status: 'active' },
        version: { id: 6, version: '1.0.0', status: 'active' },
      }),
    }
    const installer = new ExtensionInstaller({
      prisma: { skillBinding: { upsert }, chatSession: { findFirst: jest.fn().mockResolvedValue({ id: 42 }) } } as any,
      skillInstaller: skillInstaller as any,
    })

    const outcome = await installer.install({
      ...baseInput,
      plan: skillPlan,
      sessionId: 42,
    })

    expect(outcome.status).toBe('ready')
    expect(skillInstaller.installFromGithub).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'acme/demo@main:skills/pdf', actorUserId: 7 }),
    )
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ skillId: 5, versionId: 6, scopeType: 'session', scopeId: '42' }),
      }),
    )
  })

  it('surfaces pending approval for risky versions', async () => {
    const skillInstaller = {
      installFromGithub: jest.fn().mockResolvedValue({
        skill: { id: 5, slug: 'x', displayName: 'X', status: 'pending_approval' },
        version: { id: 6, version: '1.0.0', status: 'pending_approval' },
      }),
    }
    const installer = new ExtensionInstaller({
      prisma: { skillBinding: { upsert: jest.fn() }, chatSession: { findFirst: jest.fn().mockResolvedValue({ id: 42 }) } } as any,
      skillInstaller: skillInstaller as any,
    })

    const outcome = await installer.install({ ...baseInput, plan: skillPlan })

    expect(outcome.status).toBe('pending_approval')
    expect(outcome.nextSteps?.[0]).toContain('待审批')
  })
})