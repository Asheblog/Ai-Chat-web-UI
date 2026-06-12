import { McpService, McpRuntimeClient, McpServiceError } from '../mcp-service'
import type { McpRepository } from '../../../repositories/mcp-repository'
import type { SystemSetting } from '@prisma/client'

const now = new Date('2026-06-12T08:00:00.000Z')

const buildInstallation = (overrides?: Record<string, unknown>) => ({
  id: 1, namespaceKey: 'test.mcp', name: 'Test MCP', description: 'A test MCP',
  sourceType: 'remote', sourceUrl: 'https://example.com', sourceKey: null,
  registrySource: null, transport: 'streamable_http', endpoint: 'https://example.com/mcp',
  command: null, argsJson: '[]', envJson: '{}', status: 'active',
  createdBy: null, createdAt: now, updatedAt: now, ...overrides,
})

const buildConnection = (overrides?: Record<string, unknown>) => ({
  id: 10, installationId: 1, ownerUserId: null, name: 'My Conn',
  enabled: true, configJson: '{}', secretVaultId: null,
  toolSetRevision: 1, status: 'active', lastHealthCheckAt: null,
  createdAt: now, updatedAt: now,
  installation: buildInstallation(),
  ...overrides,
})

const buildService = () => {
  const repository: jest.Mocked<McpRepository> = {
    createInstallation: jest.fn(),
    findInstallationById: jest.fn(),
    findInstallationByKey: jest.fn(),
    listInstallations: jest.fn(),
    updateInstallation: jest.fn(),
    deleteInstallation: jest.fn(),
    createConnection: jest.fn(),
    findConnectionById: jest.fn(),
    listConnections: jest.fn(),
    updateConnection: jest.fn(),
    deleteConnection: jest.fn(),
    createBinding: jest.fn(),
    findBinding: jest.fn(),
    listBindings: jest.fn(),
    updateBinding: jest.fn(),
    deleteBinding: jest.fn(),
    upsertToolCache: jest.fn(),
    findToolCache: jest.fn(),
    listToolCache: jest.fn(),
    updateToolCachePin: jest.fn(),
    deleteToolCacheByConnection: jest.fn(),
  }

  const runtimeClient: jest.Mocked<McpRuntimeClient> = {
    listTools: jest.fn().mockResolvedValue([]),
    callTool: jest.fn(),
  }

  const getSystemSetting = jest.fn().mockResolvedValue(null)

  const svc = new McpService({ repository, runtimeClient, getSystemSetting } as any)
  return { svc, repository, runtimeClient, getSystemSetting }
}

describe('McpService', () => {
  describe('global gate', () => {
    it('blocks all MCP operations when global gate is disabled', async () => {
      const { svc, getSystemSetting } = buildService()
      getSystemSetting.mockResolvedValue('false')

      await expect(svc.listInstallations()).rejects.toThrow(/全局总闸/)
      await expect(svc.listConnections({})).rejects.toThrow(/全局总闸/)
      await expect(svc.listBindings({ scopeType: 'session', scopeId: '1' })).rejects.toThrow(/全局总闸/)
      await expect(svc.listToolsForSession(1)).rejects.toThrow(/全局总闸/)
    })

    it('allows operations when global gate is enabled', async () => {
      const { svc, repository, getSystemSetting } = buildService()
      getSystemSetting.mockResolvedValue('true')
      repository.listInstallations.mockResolvedValue([])

      const result = await svc.listInstallations()
      expect(result).toEqual([])
    })

    it('allows operations when global gate setting is not present (default enabled)', async () => {
      const { svc, repository } = buildService()
      repository.listInstallations.mockResolvedValue([])

      const result = await svc.listInstallations()
      expect(result).toEqual([])
    })
  })

  describe('installations', () => {
    it('admin can create remote installation', async () => {
      const { svc, repository } = buildService()
      repository.findInstallationByKey.mockResolvedValue(null)
      repository.createInstallation.mockResolvedValue(buildInstallation() as any)

      const inst = await svc.createInstallation({
        namespaceKey: 'test.mcp',
        name: 'Test MCP',
        sourceType: 'remote',
        endpoint: 'https://example.com/mcp',
        transport: 'streamable_http',
      }, true)

      expect(inst.namespaceKey).toBe('test.mcp')
      expect(inst.sourceType).toBe('remote')
    })

    it('blocks non-admin from creating local_package installation', async () => {
      const { svc } = buildService()

      await expect(svc.createInstallation({
        namespaceKey: 'local.test',
        name: 'Local MCP',
        sourceType: 'local_package',
        command: 'node server.js',
      }, false)).rejects.toThrow(/local_package.*管理员/)
    })

    it('blocks non-admin from creating any installation', async () => {
      const { svc } = buildService()

      await expect(svc.createInstallation({
        namespaceKey: 'test.mcp',
        name: 'Test',
        sourceType: 'remote',
        endpoint: 'https://example.com',
      }, false)).rejects.toThrow(/管理员/)
    })

    it('rejects duplicate namespaceKey', async () => {
      const { svc, repository } = buildService()
      repository.findInstallationByKey.mockResolvedValue(buildInstallation() as any)

      await expect(svc.createInstallation({
        namespaceKey: 'test.mcp',
        name: 'Test',
        sourceType: 'remote',
        endpoint: 'https://example.com',
      }, true)).rejects.toThrow(/已存在/)
    })
  })

  describe('connections', () => {
    it('user can create connection from remote installation', async () => {
      const { svc, repository } = buildService()
      repository.findInstallationById.mockResolvedValue(buildInstallation() as any)
      repository.createConnection.mockImplementation((data) =>
        Promise.resolve(buildConnection({ name: data.name, ownerUserId: data.ownerUserId }) as any),
      )

      const conn = await svc.createConnection({
        installationId: 1,
        ownerUserId: 42,
        name: 'My Connection',
      })

      expect(conn.name).toBe('My Connection')
      expect((conn as any).ownerUserId).toBe(42)
    })

    it('blocks user from creating connection on local_package installation', async () => {
      const { svc, repository } = buildService()
      repository.findInstallationById.mockResolvedValue(buildInstallation({
        sourceType: 'local_package',
      }) as any)

      await expect(svc.createConnection({
        installationId: 1,
        ownerUserId: 42,
        name: 'My Conn',
      })).rejects.toThrow(/local_package.*管理员/)
    })

    it('admin can create system-shared connection', async () => {
      const { svc, repository } = buildService()
      repository.findInstallationById.mockResolvedValue(buildInstallation() as any)
      repository.createConnection.mockResolvedValue(buildConnection({ ownerUserId: null }) as any)

      const conn = await svc.createConnection({
        installationId: 1,
        ownerUserId: null,
        name: 'System Shared',
      }, true)

      expect(conn.ownerUserId).toBeNull()
    })

    it('disabling connection updates status', async () => {
      const { svc, repository } = buildService()
      repository.findConnectionById.mockResolvedValue(buildConnection() as any)
      repository.updateConnection.mockResolvedValue(buildConnection({ enabled: false }) as any)

      const conn = await svc.updateConnection(10, { enabled: false })

      expect((conn as any).enabled).toBe(false)
    })
  })

  describe('bindings', () => {
    it('creates session binding with current toolSetRevision', async () => {
      const { svc, repository } = buildService()
      repository.findConnectionById.mockResolvedValue(buildConnection({ toolSetRevision: 3 }) as any)
      repository.findBinding.mockResolvedValue(null)
      repository.createBinding.mockResolvedValue({
        id: 1, connectionId: 10, scopeType: 'session', scopeId: '42',
        enabled: true, toolSetRevision: 3, createdBy: 1,
        createdAt: now, updatedAt: now,
      } as any)

      const binding = await svc.bindConnection({
        connectionId: 10,
        scopeType: 'session',
        scopeId: '42',
        createdBy: 1,
      })

      expect(binding.scopeType).toBe('session')
      expect(binding.toolSetRevision).toBe(3)
    })

    it('rejects duplicate binding', async () => {
      const { svc, repository } = buildService()
      repository.findConnectionById.mockResolvedValue(buildConnection() as any)
      repository.findBinding.mockResolvedValue({ id: 1 } as any)

      await expect(svc.bindConnection({
        connectionId: 10,
        scopeType: 'session',
        scopeId: '42',
      })).rejects.toThrow(McpServiceError)
    })
  })

  describe('tool cache', () => {
    it('refreshes tool cache from runtime client', async () => {
      const { svc, repository, runtimeClient } = buildService()
      repository.findConnectionById.mockResolvedValue(buildConnection({ toolSetRevision: 1 }) as any)
      runtimeClient.listTools.mockResolvedValue([
        { name: 'tool1', description: 'First tool', inputSchema: { type: 'object', properties: {} } },
        { name: 'tool2', description: 'Second tool', inputSchema: { type: 'object', properties: { x: { type: 'string' } } } },
      ])
      repository.updateConnection.mockResolvedValue(buildConnection({ toolSetRevision: 2 }) as any)

      const revision = await svc.refreshToolCache(10)

      expect(revision).toBe(2)
      expect(repository.upsertToolCache).toHaveBeenCalledTimes(2)
      expect(repository.upsertToolCache).toHaveBeenNthCalledWith(1, expect.objectContaining({
        connectionId: 10, originalName: 'tool1',
      }))
      expect(repository.upsertToolCache).toHaveBeenNthCalledWith(2, expect.objectContaining({
        connectionId: 10, originalName: 'tool2',
      }))
    })

    it('pins and unpins tools', async () => {
      const { svc, repository } = buildService()
      repository.findToolCache.mockResolvedValue({ id: 1 } as any)

      await svc.pinTool(10, 'tool1', 1)
      expect(repository.updateToolCachePin).toHaveBeenCalledWith(1, true, 1)

      await svc.unpinTool(10, 'tool1')
      expect(repository.updateToolCachePin).toHaveBeenCalledWith(1, false, null)
    })

    it('searches tools across connections', async () => {
      const { svc, repository } = buildService()
      repository.listToolCache.mockResolvedValue([
        { id: 1, connectionId: 10, originalName: 'search_web', description: 'Search the web',
          inputSchemaJson: '{}', pinned: true, pinnedBy: null, pinnedAt: null,
          toolSetRevision: 1, createdAt: now, updatedAt: now },
        { id: 2, connectionId: 10, originalName: 'fetch_page', description: 'Fetch a page',
          inputSchemaJson: '{}', pinned: false, pinnedBy: null, pinnedAt: null,
          toolSetRevision: 1, createdAt: now, updatedAt: now },
      ] as any)

      // Search by name
      const results = await svc.searchTools('search')
      expect(results).toHaveLength(1)
      expect(results[0]?.originalName).toBe('search_web')
    })
  })

  describe('listToolsForSession', () => {
    it('returns pinned tools for session-bound connections', async () => {
      const { svc, repository } = buildService()
      repository.listBindings.mockResolvedValue([
        { id: 1, connectionId: 10, scopeType: 'session', scopeId: '42',
          enabled: true, toolSetRevision: 1, createdBy: null,
          createdAt: now, updatedAt: now,
          connection: buildConnection({ enabled: true }),
        },
      ] as any)
      repository.listToolCache.mockResolvedValue([
        { id: 1, connectionId: 10, originalName: 'tool1', description: 'A tool',
          inputSchemaJson: '{"type":"object","properties":{}}', pinned: true, pinnedBy: 1, pinnedAt: now,
          toolSetRevision: 1, createdAt: now, updatedAt: now },
      ] as any)

      const tools = await svc.listToolsForSession(42)

      expect(tools).toHaveLength(1)
      expect(tools[0]?.name).toBe('mcp_10_tool1') // prefixed with connectionId
      expect(tools[0]?.connectionId).toBe(10)
    })

    it('returns empty when no bindings exist for session', async () => {
      const { svc, repository } = buildService()
      repository.listBindings.mockResolvedValue([])

      const tools = await svc.listToolsForSession(42)
      expect(tools).toEqual([])
    })

    it('skips disabled bindings', async () => {
      const { svc, repository } = buildService()
      repository.listBindings.mockResolvedValue([
        { id: 1, connectionId: 10, scopeType: 'session', scopeId: '42',
          enabled: false, toolSetRevision: 1, createdBy: null,
          createdAt: now, updatedAt: now,
          connection: buildConnection({ enabled: true }),
        },
      ] as any)

      const tools = await svc.listToolsForSession(42)
      expect(tools).toEqual([])
    })

    it('skips disabled connection', async () => {
      const { svc, repository } = buildService()
      repository.listBindings.mockResolvedValue([
        { id: 1, connectionId: 10, scopeType: 'session', scopeId: '42',
          enabled: true, toolSetRevision: 1, createdBy: null,
          createdAt: now, updatedAt: now,
          connection: buildConnection({ enabled: false }),
        },
      ] as any)

      const tools = await svc.listToolsForSession(42)
      expect(tools).toEqual([])
    })
  })

  describe('searchToolsForSession', () => {
    it('returns tools from bound enabled connections matching the query', async () => {
      const { svc, repository } = buildService()
      repository.listBindings.mockResolvedValue([
        { id: 1, connectionId: 10, scopeType: 'session', scopeId: '42',
          enabled: true, toolSetRevision: 1, createdBy: null,
          createdAt: now, updatedAt: now,
          connection: buildConnection({ enabled: true }),
        },
      ] as any)
      repository.listToolCache.mockResolvedValue([
        { id: 1, connectionId: 10, originalName: 'search_web', description: 'Search the web',
          inputSchemaJson: '{}', pinned: true, toolSetRevision: 1, createdAt: now, updatedAt: now },
        { id: 2, connectionId: 10, originalName: 'fetch_page', description: 'Fetch a URL',
          inputSchemaJson: '{}', pinned: false, toolSetRevision: 1, createdAt: now, updatedAt: now },
      ] as any)

      // Search matches both name and description keywords
      const results = await svc.searchToolsForSession(42, 'search')
      expect(results).toHaveLength(1)
      expect(results[0]?.originalName).toBe('search_web')
    })

    it('returns tools regardless of pinned state (per ADR 0013)', async () => {
      const { svc, repository } = buildService()
      repository.listBindings.mockResolvedValue([
        { id: 1, connectionId: 10, scopeType: 'session', scopeId: '42',
          enabled: true, toolSetRevision: 1, createdBy: null,
          createdAt: now, updatedAt: now,
          connection: buildConnection({ enabled: true }),
        },
      ] as any)
      repository.listToolCache.mockResolvedValue([
        { id: 1, connectionId: 10, originalName: 'unpinned_tool',
          description: 'Not pinned but searchable',
          inputSchemaJson: '{}', pinned: false, toolSetRevision: 1, createdAt: now, updatedAt: now },
      ] as any)

      const results = await svc.searchToolsForSession(42, 'unpinned')
      expect(results).toHaveLength(1)
      expect(results[0]?.originalName).toBe('unpinned_tool')
    })

    it('does not return tools from unbound connections', async () => {
      const { svc, repository } = buildService()
      repository.listBindings.mockResolvedValue([
        { id: 1, connectionId: 10, scopeType: 'session', scopeId: '42',
          enabled: true, toolSetRevision: 1, createdBy: null,
          createdAt: now, updatedAt: now,
          connection: buildConnection({ enabled: true }),
        },
      ] as any)
      repository.listToolCache.mockResolvedValue([
        { id: 1, connectionId: 20, originalName: 'other_conn_tool',
          description: 'On different connection',
          inputSchemaJson: '{}', pinned: true, toolSetRevision: 1, createdAt: now, updatedAt: now },
      ] as any)

      const results = await svc.searchToolsForSession(42, 'tool')
      expect(results).toHaveLength(0)
    })

    it('skips disabled bindings when searching', async () => {
      const { svc, repository } = buildService()
      repository.listBindings.mockResolvedValue([
        { id: 1, connectionId: 10, scopeType: 'session', scopeId: '42',
          enabled: false, toolSetRevision: 1, createdBy: null,
          createdAt: now, updatedAt: now,
          connection: buildConnection({ enabled: true }),
        },
      ] as any)
      repository.listToolCache.mockResolvedValue([
        { id: 1, connectionId: 10, originalName: 'tool1', description: 'A tool',
          inputSchemaJson: '{}', pinned: true, toolSetRevision: 1, createdAt: now, updatedAt: now },
      ] as any)

      const results = await svc.searchToolsForSession(42, 'tool')
      expect(results).toHaveLength(0)
    })

    it('skips disabled connection when searching', async () => {
      const { svc, repository } = buildService()
      repository.listBindings.mockResolvedValue([
        { id: 1, connectionId: 10, scopeType: 'session', scopeId: '42',
          enabled: true, toolSetRevision: 1, createdBy: null,
          createdAt: now, updatedAt: now,
          connection: buildConnection({ enabled: false }),
        },
      ] as any)
      repository.listToolCache.mockResolvedValue([
        { id: 1, connectionId: 10, originalName: 'tool1', description: 'A tool',
          inputSchemaJson: '{}', pinned: true, toolSetRevision: 1, createdAt: now, updatedAt: now },
      ] as any)

      const results = await svc.searchToolsForSession(42, 'tool')
      expect(results).toHaveLength(0)
    })

    it('returns empty when no bindings exist', async () => {
      const { svc, repository } = buildService()
      repository.listBindings.mockResolvedValue([])

      const results = await svc.searchToolsForSession(99, 'anything')
      expect(results).toEqual([])
    })
  })

  describe('getToolDetailForSession', () => {
    it('returns tool detail for a bound connection', async () => {
      const { svc, repository } = buildService()
      repository.listBindings.mockResolvedValue([
        { id: 1, connectionId: 10, scopeType: 'session', scopeId: '42',
          enabled: true, toolSetRevision: 1, createdBy: null,
          createdAt: now, updatedAt: now,
          connection: buildConnection({ enabled: true }),
        },
      ] as any)
      repository.findToolCache.mockResolvedValue({
        id: 1, connectionId: 10, originalName: 'search',
        description: 'Search tool',
        inputSchemaJson: '{"type":"object","properties":{}}',
        pinned: true, pinnedBy: null, pinnedAt: null,
        toolSetRevision: 1, createdAt: now, updatedAt: now,
      } as any)

      const tool = await svc.getToolDetailForSession(42, 10, 'search')
      expect(tool.originalName).toBe('search')
    })

    it('throws 404 for an unbound connection', async () => {
      const { svc, repository } = buildService()
      repository.listBindings.mockResolvedValue([
        { id: 1, connectionId: 10, scopeType: 'session', scopeId: '42',
          enabled: true, toolSetRevision: 1, createdBy: null,
          createdAt: now, updatedAt: now,
          connection: buildConnection({ enabled: true }),
        },
      ] as any)

      await expect(
        svc.getToolDetailForSession(42, 99, 'some_tool'),
      ).rejects.toThrow(McpServiceError)
    })

    it('throws 404 when connection exists but binding is disabled', async () => {
      const { svc, repository } = buildService()
      repository.listBindings.mockResolvedValue([
        { id: 1, connectionId: 10, scopeType: 'session', scopeId: '42',
          enabled: false, toolSetRevision: 1, createdBy: null,
          createdAt: now, updatedAt: now,
          connection: buildConnection({ enabled: true }),
        },
      ] as any)

      await expect(
        svc.getToolDetailForSession(42, 10, 'some_tool'),
      ).rejects.toThrow(McpServiceError)
    })

    it('throws 404 when session has no bindings at all', async () => {
      const { svc, repository } = buildService()
      repository.listBindings.mockResolvedValue([])

      await expect(
        svc.getToolDetailForSession(99, 10, 'some_tool'),
      ).rejects.toThrow(McpServiceError)
    })
  })

  describe('ownership enforcement', () => {
    it('listConnections respects ownerUserId filter', async () => {
      const { svc, repository } = buildService()
      repository.listConnections.mockResolvedValue([
        buildConnection({ id: 10, ownerUserId: 42 }), // belongs to user 42
      ] as any)

      const results = await svc.listConnections({ ownerUserId: 42 })
      expect(results).toHaveLength(1)
      expect((results[0] as any).ownerUserId).toBe(42)
    })

    it('listConnections returns empty for non-owner', async () => {
      const { svc, repository } = buildService()
      repository.listConnections.mockResolvedValue([])

      const results = await svc.listConnections({ ownerUserId: 42 })
      expect(results).toEqual([])
    })

    it('getConnection allows system-shared connection (ownerUserId=null)', async () => {
      const { svc, repository } = buildService()
      repository.findConnectionById.mockResolvedValue(buildConnection({ ownerUserId: null }) as any)

      const conn = await svc.getConnection(10)
      expect(conn).toBeTruthy()
    })

    it('getConnection allows owner to access their connection', async () => {
      const { svc, repository } = buildService()
      repository.findConnectionById.mockResolvedValue(buildConnection({ ownerUserId: 42 }) as any)

      const conn = await svc.getConnection(10)
      expect(conn).toBeTruthy()
    })
  })
})
