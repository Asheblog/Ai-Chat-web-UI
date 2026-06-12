import { McpToolAdapter } from '../mcp-tool-adapter'
import type { McpService } from '../mcp-service'

const buildAdapter = (overrides?: { mcpService?: Partial<jest.Mocked<McpService>> }) => {
  const mcpService = {
    listToolsForSession: jest.fn().mockResolvedValue([]),
    callTool: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'result' }] }),
    searchTools: jest.fn().mockResolvedValue([]),
    getToolDetail: jest.fn().mockResolvedValue({}),
    searchToolsForSession: jest.fn().mockResolvedValue([]),
    getToolDetailForSession: jest.fn().mockResolvedValue({}),
    ...overrides?.mcpService,
  }
  const adapter = new McpToolAdapter(mcpService as unknown as McpService)
  return { adapter, mcpService }
}

describe('McpToolAdapter', () => {
  describe('getToolDefinitions', () => {
    it('returns pinned tools with prefixed names and source=mcp', async () => {
      const { adapter, mcpService } = buildAdapter({
        mcpService: {
          listToolsForSession: jest.fn().mockResolvedValue([
            {
              name: 'mcp_10_search', originalName: 'search', connectionId: 10,
              description: 'Search the web',
              inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
              pinned: true, toolSetRevision: 1,
            },
          ]),
        },
      })

      const defs = await adapter.getToolDefinitions(42)

      const pinned = defs.filter(d => d.source === 'mcp')
      expect(pinned).toHaveLength(1)
      expect(pinned[0]!.function.name).toBe('mcp_10_search')
      expect(pinned[0]!.function.description).toContain('Search the web')
      expect(pinned[0]!.source).toBe('mcp')
      expect(pinned[0]!.connectionId).toBe(10)
    })

    it('always includes meta-tools for progressive discovery', async () => {
      const { adapter } = buildAdapter()

      const defs = await adapter.getToolDefinitions(99)

      const meta = defs.filter(d => d.source === 'mcp_meta')
      expect(meta).toHaveLength(2)
      expect(meta.map(d => d.function.name).sort()).toEqual(
        ['mcp_get_tool_description', 'mcp_search_tools'].sort(),
      )
    })

    it('returns only meta-tools when no session bindings', async () => {
      const { adapter } = buildAdapter()

      const defs = await adapter.getToolDefinitions(999)
      expect(defs).toHaveLength(2) // meta-tools only
      expect(defs.every(d => d.source === 'mcp_meta')).toBe(true)
    })
  })

  describe('canHandle', () => {
    it('recognizes MCP-prefixed tool names', () => {
      const { adapter } = buildAdapter()

      expect(adapter.canHandle('mcp_10_search')).toBe(true)
      expect(adapter.canHandle('mcp_search_tools')).toBe(true)
      expect(adapter.canHandle('mcp_get_tool_description')).toBe(true)
      expect(adapter.canHandle('builtin_web_search')).toBe(false)
    })
  })

  describe('handle - meta-tools', () => {
    it('mcp_search_tools calls searchToolsForSession with sessionId and formats results', async () => {
      const { adapter, mcpService } = buildAdapter({
        mcpService: {
          searchToolsForSession: jest.fn().mockResolvedValue([
            { id: 1, connectionId: 10, originalName: 'web_search',
              description: 'Search web', inputSchemaJson: '{}',
              pinned: true, pinnedBy: null, pinnedAt: null,
              toolSetRevision: 1, createdAt: new Date(), updatedAt: new Date() },
          ]),
        },
      })

      const result = await adapter.handle(
        { function: { name: 'mcp_search_tools' } },
        { query: 'search' },
        { sessionId: 42, messageId: 1, sendToolEvent: jest.fn(),
          emitReasoning: jest.fn(), userId: 1 } as any,
      )

      expect(mcpService.searchToolsForSession).toHaveBeenCalledWith(42, 'search')
      expect(mcpService.searchTools).not.toHaveBeenCalled()
      expect(result.toolName).toBe('mcp_search_tools')
      expect(result.message.role).toBe('tool')
      expect(result.message.content).toContain('web_search')
      expect(result.message.content).toContain('callRef')
    })

    it('mcp_get_tool_description calls getToolDetailForSession with sessionId and formats', async () => {
      const { adapter, mcpService } = buildAdapter({
        mcpService: {
          getToolDetailForSession: jest.fn().mockResolvedValue({
            id: 1, connectionId: 10, originalName: 'search',
            description: 'Search tool',
            inputSchemaJson: '{"type":"object","properties":{"q":{"type":"string"}}}',
            pinned: true, pinnedBy: null, pinnedAt: null,
            toolSetRevision: 1, createdAt: new Date(), updatedAt: new Date(),
          }),
        },
      })

      const result = await adapter.handle(
        { function: { name: 'mcp_get_tool_description' } },
        { connectionId: 10, toolName: 'search' },
        { sessionId: 42, messageId: 1, sendToolEvent: jest.fn(),
          emitReasoning: jest.fn() } as any,
      )

      expect(mcpService.getToolDetailForSession).toHaveBeenCalledWith(42, 10, 'search')
      expect(mcpService.getToolDetail).not.toHaveBeenCalled()
      expect(result.message.content).toContain('inputSchema')
      expect(result.message.content).toContain('callRef')
    })
  })

  describe('handle - MCP runtime tool', () => {
    it('routes to McpService.callTool via parseToolName', async () => {
      const { adapter, mcpService } = buildAdapter({
        mcpService: {
          listToolsForSession: jest.fn().mockResolvedValue([
            {
              name: 'mcp_10_search', originalName: 'search', connectionId: 10,
              description: 'Search', inputSchema: {},
              pinned: true, toolSetRevision: 3,
            },
          ]),
          callTool: jest.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'hello world' }],
          }),
        },
      })
      // Pre-load cache so toolSetRevision is available
      await adapter.getToolDefinitions(42)

      const sendToolEvent = jest.fn()
      const result = await adapter.handle(
        { id: 'call-1', function: { name: 'mcp_10_search' } },
        { q: 'test' },
        { sessionId: 42, messageId: 1, sendToolEvent,
          emitReasoning: jest.fn() } as any,
      )

      expect(mcpService.callTool).toHaveBeenCalledWith(10, 'search', { q: 'test' })
      expect(result.message.content).toBe('hello world')
      // tool event should include source, connectionId, originalToolName, toolSetRevision
      expect(sendToolEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'mcp_10_search',
          stage: 'start',
          details: expect.objectContaining({
            source: 'mcp',
            connectionId: 10,
            originalToolName: 'search',
            toolSetRevision: 3,
          }),
        }),
      )
    })

    it('returns error content when callTool fails', async () => {
      const { adapter, mcpService } = buildAdapter({
        mcpService: {
          callTool: jest.fn().mockRejectedValue(new Error('MCP runtime error')),
        },
      })

      const result = await adapter.handle(
        { id: 'call-1', function: { name: 'mcp_10_search' } },
        {},
        { sessionId: 42, sendToolEvent: jest.fn(),
          emitReasoning: jest.fn() } as any,
      )

      expect(result.message.content).toContain('MCP 工具错误')
      expect(result.message.content).toContain('MCP runtime error')
    })

    it('throws for unrecognized MCP tool format', async () => {
      const { adapter } = buildAdapter()

      await expect(
        adapter.handle(
          { function: { name: 'mcp_invalid' } },
          {},
          { sessionId: 42, sendToolEvent: jest.fn(),
            emitReasoning: jest.fn() } as any,
        ),
      ).rejects.toThrow(/Unknown MCP tool/)
    })
  })
})
