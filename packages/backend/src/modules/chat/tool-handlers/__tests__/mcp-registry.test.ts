import { ToolHandlerRegistry } from '../registry'
import { McpToolAdapter } from '../../../../services/mcp/mcp-tool-adapter'
import type { McpService } from '../../../../services/mcp/mcp-service'

describe('ToolHandlerRegistry with McpToolAdapter', () => {
  it('registers McpToolAdapter and exposes meta-tools + pinned tools', async () => {
    const mcpService = {
      listToolsForSession: jest.fn().mockResolvedValue([
        {
          name: 'mcp_10_search', originalName: 'search', connectionId: 10,
          description: 'Search the web',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
          pinned: true, toolSetRevision: 1,
        },
      ]),
      callTool: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'result' }] }),
      searchTools: jest.fn().mockResolvedValue([]),
      getToolDetail: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<McpService>

    const registry = new ToolHandlerRegistry()
    const adapter = new McpToolAdapter(mcpService)
    registry.register(adapter)

    // Pre-load tools (simulates what createSkillRegistry does)
    await adapter.getToolDefinitions(42)

    const defs = registry.getToolDefinitions()
    // Should contain meta-tools + pinned tool
    expect(defs.find(d => d.function.name === 'mcp_search_tools')).toBeTruthy()
    expect(defs.find(d => d.function.name === 'mcp_get_tool_description')).toBeTruthy()
    expect(defs.find(d => d.function.name === 'mcp_10_search')).toBeTruthy()

    const allowedNames = registry.getAllowedToolNames()
    expect(allowedNames.has('mcp_search_tools')).toBe(true)
    expect(allowedNames.has('mcp_get_tool_description')).toBe(true)
    expect(allowedNames.has('mcp_10_search')).toBe(true)

    expect(registry.hasHandler('mcp_10_search')).toBe(true)
    expect(registry.hasHandler('mcp_search_tools')).toBe(true)
    expect(registry.getHandler('mcp_10_search')).toBe(adapter)
    expect(registry.getHandler('mcp_search_tools')).toBe(adapter)
  })

  it('handleToolCall routes mcp_search_tools to adapter.callTool', async () => {
    const mcpService = {
      listToolsForSession: jest.fn().mockResolvedValue([]),
      callTool: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'result' }] }),
      searchTools: jest.fn().mockResolvedValue([]),
      getToolDetail: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<McpService>

    const registry = new ToolHandlerRegistry()
    const adapter = new McpToolAdapter(mcpService)
    registry.register(adapter)

    const result = await registry.handleToolCall(
      'mcp_search_tools',
      { id: 'c1', function: { name: 'mcp_search_tools' } },
      { query: 'test' },
      { sessionId: 1, sendToolEvent: jest.fn(), emitReasoning: jest.fn() } as any,
    )

    expect(result).not.toBeNull()
    expect(result!.toolName).toBe('mcp_search_tools')
  })
})
