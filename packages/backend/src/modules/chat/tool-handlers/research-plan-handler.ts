/**
 * 深度研究计划工具处理器。
 *
 * 处理结果在 approvalGate 返回前保持 pending；approve/adjust 返回普通工具结果让
 * 模型继续（adjust 会引导模型重新生成计划），cancel/expired 返回 termination，
 * 由工具编排器结束当前流。
 */

import { randomUUID } from 'node:crypto'
import { parseResearchPlanArgs, type ResearchPlanPayload } from '../research-plan-tool'
import type {
  DeepResearchPlanHandlerConfig,
  IToolHandler,
  ToolCall,
  ToolCallContext,
  ToolDefinition,
  ToolHandlerResult,
} from './types'

export class ResearchPlanToolHandler implements IToolHandler {
  readonly toolName = 'research_plan'
  private readonly config: DeepResearchPlanHandlerConfig

  constructor(config: DeepResearchPlanHandlerConfig) {
    this.config = config
  }

  get toolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.toolName,
        description:
          '向用户提交深度研究计划并等待确认。必须在深度研究模式下执行任何搜索或网页读取之前调用；用户批准后才能继续。',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '研究标题' },
            objective: { type: 'string', description: '一句话研究目标' },
            sub_questions: {
              type: 'array',
              minItems: 3,
              maxItems: 6,
              description: '3-6 个关键子问题，每个子问题包含 question 和 1-3 个搜索关键词',
              items: {
                type: 'object',
                properties: {
                  question: { type: 'string', description: '子问题' },
                  keywords: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 3,
                    description: '搜索关键词',
                    items: { type: 'string' },
                  },
                },
                required: ['question', 'keywords'],
              },
            },
            estimated_tool_rounds: {
              type: 'object',
              description: '预计工具调用轮数范围',
              properties: {
                min: { type: 'number', minimum: 1 },
                max: { type: 'number', maximum: 20 },
              },
              required: ['min', 'max'],
            },
            deliverable: {
              type: 'string',
              description: '固定交付物标识',
              const: 'markdown_report_with_citations_pdf',
            },
            notes: { type: 'string', description: '可选：假设、边界、无法回答的部分' },
          },
          required: ['title', 'objective', 'sub_questions', 'estimated_tool_rounds'],
        },
      },
    }
  }

  canHandle(toolName: string): boolean {
    return toolName === this.toolName
  }

  async handle(
    toolCall: ToolCall,
    args: Record<string, unknown>,
    context: ToolCallContext,
  ): Promise<ToolHandlerResult> {
    const callId = toolCall.id || randomUUID()

    const buildResult = (
      content: Record<string, unknown>,
      options: {
        event?: Record<string, unknown>
        termination?: ToolHandlerResult['termination']
      } = {},
    ): ToolHandlerResult => {
      if (options.event) {
        context.sendToolEvent({ id: callId, tool: this.toolName, ...options.event })
      }
      return {
        toolCallId: callId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: this.toolName,
          content: JSON.stringify(content),
        },
        ...(options.termination ? { termination: options.termination } : {}),
      }
    }

    const buildError = (message: string): ToolHandlerResult =>
      buildResult(
        { error: message },
        {
          event: {
            stage: 'error',
            status: 'error',
            phase: 'error',
            error: message,
          },
        },
      )

    const parsed = parseResearchPlanArgs(args)
    if (!parsed.ok) {
      return buildError(parsed.error)
    }
    const plan: ResearchPlanPayload = parsed.plan

    context.sendToolEvent({
      id: callId,
      tool: this.toolName,
      stage: 'start',
      status: 'pending',
      phase: 'pending_approval',
      summary: '等待确认研究计划',
      details: {
        plan,
        approval: {
          kind: 'plan',
          revision: this.currentRevision(context),
          expiresAt: Date.now() + this.config.approvalTimeoutMs,
        },
      },
    })

    const outcome = await this.config.approvalGate.waitForDecision({
      plan,
      toolCallId: callId,
      revision: this.currentRevision(context),
      context,
    })

    if (outcome.decision === 'approve') {
      return buildResult(
        { status: 'approved', message: '研究计划已确认，请按计划开始执行。', plan },
        {
          event: {
            stage: 'result',
            status: 'success',
            phase: 'result',
            summary: '研究计划已确认',
            details: {
              plan,
              approval: {
                kind: 'plan',
                decision: 'approve',
                revision: outcome.revision,
              },
            },
          },
        },
      )
    }

    if (outcome.decision === 'adjust') {
      const feedback = outcome.feedback || ''
      return buildResult(
        {
          status: 'revision_requested',
          message: '用户已提出调整意见，请根据反馈重新生成完整研究计划，并再次调用 research_plan。',
          feedback,
          plan,
        },
        {
          event: {
            stage: 'result',
            status: 'success',
            phase: 'result',
            summary: '已收到调整意见，正在重新生成计划',
            details: {
              plan,
              approval: {
                kind: 'plan',
                decision: 'adjust',
                feedback,
                revision: outcome.revision,
              },
            },
          },
        },
      )
    }

    if (outcome.decision === 'cancel') {
      return buildResult(
        { status: 'cancelled', message: '用户取消了深度研究。' },
        {
          event: {
            stage: 'error',
            status: 'rejected',
            phase: 'rejected',
            summary: '深度研究已取消',
            error: '深度研究已取消',
            details: {
              plan,
              approval: { kind: 'plan', decision: 'cancel', revision: outcome.revision },
            },
          },
          termination: {
            code: 'research_plan_cancelled',
            message: '深度研究已取消',
          },
        },
      )
    }

    return buildResult(
      { status: 'expired', message: '研究计划确认超时。' },
      {
        event: {
          stage: 'error',
          status: 'aborted',
          phase: 'aborted',
          summary: '研究计划已过期',
          error: '研究计划已过期，请重新发起深度研究',
          details: {
            plan,
            approval: { kind: 'plan', decision: 'expired', revision: outcome.revision },
          },
        },
        termination: {
          code: 'research_plan_expired',
          message: '研究计划已过期，请重新发起深度研究',
        },
      },
    )
  }

  /**
   * 修订轮数由 approvalGate 结果回传；这里只提供默认 0。
   * 实际 gate 闭包会根据流内状态返回准确 revision。
   */
  private currentRevision(context: ToolCallContext): number {
    const resolved = this.config.resolveRevision?.()
    return typeof resolved === 'number' && Number.isFinite(resolved)
      ? Math.max(0, Math.min(2, resolved))
      : 0
  }
}
