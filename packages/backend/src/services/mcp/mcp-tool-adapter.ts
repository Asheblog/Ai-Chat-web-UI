import { randomUUID } from 'node:crypto'
import { McpService } from './mcp-service'
import type { IToolHandler, ToolCall, ToolCallContext, ToolDefinition, ToolHandlerResult } from '../../modules/chat/tool-handlers/types'

export interface McpToolDefinition extends ToolDefinition {
  source: 'mcp' | 'mcp_meta'
  connectionId?: number
  originalToolName?: string
  toolSetRevision?: number
}

const META_SEARCH_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'mcp_search_tools',
    description:
      '搜索当前会话绑定的 MCP 连接中可用的工具。通过关键词匹配名称和描述，返回工具列表（含固定状态）。未固定的工具也可通过此方式发现后直接引用调用。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词，匹配工具名称和描述' },
      },
      required: ['query'],
    },
  },
}

const META_DETAIL_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'mcp_get_tool_description',
    description:
      '获取指定 MCP 工具的详细描述和输入参数 schema。使用此工具了解工具的完整输入定义后再调用。',
    parameters: {
      type: 'object',
      properties: {
        connectionId: { type: 'integer', description: 'MCP 连接 ID，来自搜索结果的 connectionId' },
        toolName: { type: 'string', description: '原始工具名，来自搜索结果的 originalName' },
      },
      required: ['connectionId', 'toolName'],
    },
  },
}

export class McpToolAdapter implements IToolHandler {
  readonly toolName = 'mcp_adapter'
  readonly toolDefinition: ToolDefinition = {
    type: 'function',
    function: { name: 'mcp_adapter', description: 'MCP tool dispatcher', parameters: { type: 'object', properties: {} } },
  }

  private mcpService: McpService
  private cachedDefs: Map<number, McpToolDefinition[]> = new Map()

  constructor(mcpService: McpService) {
    this.mcpService = mcpService
  }

  /** Get all cached tool names (for allowedToolNames). */
  getCachedToolNames(): string[] {
    const names: string[] = []
    for (const [, defs] of this.cachedDefs) {
      for (const def of defs) {
        names.push(def.function.name)
      }
    }
    return names
  }

  /** Get cached definitions for a specific session. */
  getCachedDefinitions(sessionId: number): McpToolDefinition[] {
    return this.cachedDefs.get(sessionId) ?? []
  }

  /** Get all cached definitions from all sessions. */
  getAllCachedDefinitions(): McpToolDefinition[] {
    const result: McpToolDefinition[] = []
    for (const [, defs] of this.cachedDefs) {
      result.push(...defs)
    }
    return result
  }

  /** Get all tool definitions for a session (pinned tools + meta-tools). */
  async getToolDefinitions(sessionId: number): Promise<McpToolDefinition[]> {
    const defs: McpToolDefinition[] = []

    // Meta-tools for progressive discovery
    defs.push({ ...META_SEARCH_TOOL, source: 'mcp_meta' } as McpToolDefinition)
    defs.push({ ...META_DETAIL_TOOL, source: 'mcp_meta' } as McpToolDefinition)

    // Pinned MCP tools for this session
    try {
      const tools = await this.mcpService.listToolsForSession(sessionId)
      for (const tool of tools) {
        defs.push({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description ?? `MCP tool: ${tool.originalName} (connection #${tool.connectionId})`,
            parameters: (tool.inputSchema as { type: 'object'; properties: Record<string, unknown>; required?: string[] }) ?? { type: 'object', properties: {} },
          },
          source: 'mcp',
          connectionId: tool.connectionId,
          originalToolName: tool.originalName,
          toolSetRevision: tool.toolSetRevision,
        })
      }
    } catch {
      // If MCP is globally disabled, no pinned tools
    }

    this.cachedDefs.set(sessionId, defs)
    return defs
  }

  canHandle(toolName: string): boolean {
    return (
      toolName.startsWith('mcp_') ||
      toolName === 'mcp_search_tools' ||
      toolName === 'mcp_get_tool_description'
    )
  }

  async handle(
    toolCall: ToolCall,
    args: Record<string, unknown>,
    context: ToolCallContext,
  ): Promise<ToolHandlerResult> {
    const name = toolCall.function?.name ?? (toolCall as any).name ?? ''

    // Meta-tools
    if (name === 'mcp_search_tools') {
      return this.handleSearchTools(toolCall, args as any, context)
    }
    if (name === 'mcp_get_tool_description') {
      return this.handleGetToolDetail(toolCall, args as any, context)
    }

    // MCP runtime tool call
    return this.handleMcpCall(toolCall, name, args, context)
  }

  private async handleSearchTools(
    toolCall: ToolCall,
    args: { query: string },
    context: ToolCallContext,
  ): Promise<ToolHandlerResult> {
    try {
      const results = await this.mcpService.searchToolsForSession(context.sessionId, args.query)
      const content = JSON.stringify(
        results.map((t) => ({
          originalName: t.originalName,
          connectionId: t.connectionId,
          description: t.description,
          pinned: t.pinned,
          callRef: `mcp_${t.connectionId}_${t.originalName}`,
        })),
        null,
        2,
      )
      return this.result(toolCall, 'mcp_search_tools', content)
    } catch (error) {
      return this.errorResult(toolCall, 'mcp_search_tools', error)
    }
  }

  private async handleGetToolDetail(
    toolCall: ToolCall,
    args: { connectionId: number; toolName: string },
    context: ToolCallContext,
  ): Promise<ToolHandlerResult> {
    try {
      const tool = await this.mcpService.getToolDetailForSession(context.sessionId, args.connectionId, args.toolName)
      const content = JSON.stringify(
        {
          originalName: tool.originalName,
          connectionId: tool.connectionId,
          description: tool.description,
          inputSchema: JSON.parse(tool.inputSchemaJson || '{}'),
          callRef: `mcp_${tool.connectionId}_${tool.originalName}`,
        },
        null,
        2,
      )
      return this.result(toolCall, 'mcp_get_tool_description', content)
    } catch (error) {
      return this.errorResult(toolCall, 'mcp_get_tool_description', error)
    }
  }

  private async handleMcpCall(
    toolCall: ToolCall,
    prefixedName: string,
    args: Record<string, unknown>,
    context: ToolCallContext,
  ): Promise<ToolHandlerResult> {
    const parsed = McpService.parseToolName(prefixedName)
    if (!parsed) {
      throw new Error(`Unknown MCP tool: ${prefixedName}`)
    }

    // Look up the revision from cached definitions
    let revision: number | undefined
    for (const [, defs] of this.cachedDefs) {
      const found = defs.find(d => d.function.name === prefixedName)
      if (found) { revision = found.toolSetRevision; break }
    }

    context.sendToolEvent({
      id: toolCall.id || randomUUID(),
      tool: prefixedName,
      stage: 'start',
      summary: `MCP 工具: ${parsed.originalName} (连接 #${parsed.connectionId})`,
      details: {
        source: 'mcp',
        connectionId: parsed.connectionId,
        originalToolName: parsed.originalName,
        toolSetRevision: revision,
      },
    })

    try {
      const result = await this.mcpService.callTool(parsed.connectionId, parsed.originalName, args)
      const textContent = result.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('\n')

      return this.result(toolCall, prefixedName, textContent || JSON.stringify(result.content))
    } catch (error) {
      return this.errorResult(toolCall, prefixedName, error)
    }
  }

  private result(toolCall: ToolCall, name: string, content: string): ToolHandlerResult {
    const callId = toolCall.id || randomUUID()
    return {
      toolCallId: callId,
      toolName: name,
      message: {
        role: 'tool',
        tool_call_id: callId,
        name,
        content,
      },
    }
  }

  private errorResult(toolCall: ToolCall, name: string, error: unknown): ToolHandlerResult {
    const message = error instanceof Error ? error.message : String(error)
    return this.result(toolCall, name, `MCP 工具错误: ${message}`)
  }
}
