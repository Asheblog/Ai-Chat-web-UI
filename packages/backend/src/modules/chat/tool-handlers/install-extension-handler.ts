import { randomUUID } from 'node:crypto'
import type {
  ExtensionInstallHandlerConfig,
  IToolHandler,
  ToolCall,
  ToolCallContext,
  ToolDefinition,
  ToolHandlerResult,
} from '../../../agent-runtime/tool-handler-types'
import type { InstallOutcome, InstallPlan } from '../../extensions/types'

export type { ExtensionInstallHandlerConfig }

const TOOL_NAME = 'install_extension'

const DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: TOOL_NAME,
    description:
      '安装一个 AI 能力扩展：MCP 服务或 Skill。当用户给出 MCP / Skill 的 GitHub 仓库链接，' +
      '或要求「安装/接入/添加某个能力、工具、服务」时调用。' +
      '工具会自动识别来源类型（远程 MCP / 本地包 MCP / Skill）、生成配置、完成安装与登记；' +
      'MCP 会真实握手验证工具清单，Skill 仍需通过既有审批/校验后才会启用。' +
      '不要凭猜测调用：没有明确仓库链接或服务来源时，先向用户确认。',
    parameters: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description:
            'GitHub 仓库链接，支持 https://github.com/owner/repo、/tree/<ref>/<subdir>、' +
            '/blob/.../SKILL.md，或 owner/repo@ref:subdir 简写。',
        },
        kind: {
          type: 'string',
          enum: ['auto', 'mcp', 'skill'],
          description: '扩展类型。默认 auto：由仓库内容判定；用户明确说「这是 Skill / 这是 MCP」时再指定。',
        },
        scope: {
          type: 'string',
          enum: ['user', 'system'],
          description: '安装范围。不填时管理员默认 system（系统级模板），普通用户默认 user（仅自己可用）。',
        },
        enable: {
          type: 'boolean',
          description: '是否安装后立即启用并绑定到当前会话。默认 true。',
        },
      },
      required: ['source'],
    },
  },
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 对外契约：规格 §3 用 detected 描述判定结果，内部类型仍叫 plan。 */
function toDetected(plan: InstallPlan) {
  return {
    kind: plan.kind,
    name: plan.name,
    confidence: plan.confidence,
    reason: plan.reason,
    source: plan.source,
    sourceUrl: plan.sourceUrl,
    sourceType: plan.sourceType,
    transport: plan.transport,
    endpoint: plan.endpoint,
    command: plan.command,
    args: plan.args,
    subdir: plan.subdir,
    envKeys: plan.envKeys,
  }
}

function toToolPayload(outcome: InstallOutcome) {
  return {
    ok: outcome.ok,
    status: outcome.status,
    detected: outcome.plan ? toDetected(outcome.plan) : undefined,
    candidates: outcome.candidates?.map(toDetected),
    installed: outcome.installed,
    tools: outcome.tools,
    requiredSecrets: outcome.requiredSecrets,
    nextSteps: outcome.nextSteps,
    warnings: outcome.warnings,
    error: outcome.error,
  }
}

/**
 * 模型可调用的扩展安装工具。
 * 只做参数归一、进度事件与结果回填；识别、权限、安装都在 ExtensionInstallService 内完成。
 */
export class InstallExtensionToolHandler implements IToolHandler {
  readonly toolName = TOOL_NAME
  readonly toolDefinition = DEFINITION
  private readonly config: ExtensionInstallHandlerConfig

  constructor(config: ExtensionInstallHandlerConfig) {
    this.config = config
  }

  canHandle(toolName: string): boolean {
    return toolName === TOOL_NAME
  }

  async handle(
    toolCall: ToolCall,
    args: Record<string, unknown>,
    context: ToolCallContext,
  ): Promise<ToolHandlerResult> {
    const callId = toolCall.id || randomUUID()
    const source = asString(args.source)
    const kindRaw = asString(args.kind).toLowerCase()
    const kind = kindRaw === 'mcp' || kindRaw === 'skill' ? kindRaw : 'auto'
    const scopeRaw = asString(args.scope).toLowerCase()
    // 缺省留给服务层按角色决定（管理员 → system，普通用户 → user）
    const scope = scopeRaw === 'system' || scopeRaw === 'user' ? (scopeRaw as 'system' | 'user') : undefined
    const enable = args.enable === undefined ? true : Boolean(args.enable)

    const finish = (content: string): ToolHandlerResult => ({
      toolCallId: callId,
      toolName: TOOL_NAME,
      message: {
        role: 'tool',
        tool_call_id: toolCall.id,
        name: TOOL_NAME,
        content,
      },
    })

    if (!this.config.enabled) {
      return finish(JSON.stringify({ ok: false, error: '扩展安装工具已被管理员关闭' }))
    }
    if (!source) {
      return finish(JSON.stringify({ ok: false, error: '缺少 source（GitHub 仓库链接）' }))
    }
    if (!context.actorUserId) {
      return finish(JSON.stringify({ ok: false, error: '需要登录后才能安装扩展' }))
    }

    context.sendToolEvent({
      id: callId,
      tool: TOOL_NAME,
      stage: 'start',
      summary: `安装扩展：${source}`,
      details: { source, kind, scope, enable },
    })

    try {
      const outcome = await this.config.service.installFromSource({
        source,
        kindHint: kind,
        scope,
        enable,
        actorUserId: context.actorUserId,
        sessionId: context.sessionId,
        onProgress: (stage: string, detail: string) => {
          context.sendToolEvent({
            id: callId,
            tool: TOOL_NAME,
            stage: 'progress',
            summary: detail,
            details: { stage },
          })
        },
      })

      const summary = outcome.ok
        ? `${outcome.plan?.kind === 'skill' ? 'Skill' : 'MCP'} 安装完成（${outcome.status ?? 'ok'}）`
        : `安装未完成：${outcome.error ?? 'unknown'}`

      context.sendToolEvent({
        id: callId,
        tool: TOOL_NAME,
        stage: outcome.ok ? 'end' : 'error',
        summary,
        details: {
          status: outcome.status,
          kind: outcome.plan?.kind,
          tools: outcome.tools?.length ?? 0,
        },
      })

      return finish(JSON.stringify(toToolPayload(outcome), null, 2))
    } catch (error) {
      const message = (error as Error)?.message ?? 'unknown'
      context.sendToolEvent({
        id: callId,
        tool: TOOL_NAME,
        stage: 'error',
        error: message,
      })
      return finish(JSON.stringify({ ok: false, error: message }))
    }
  }
}
