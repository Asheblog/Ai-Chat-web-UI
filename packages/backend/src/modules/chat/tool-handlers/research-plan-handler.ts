/**
 * 深度研究计划工具处理器。
 *
 * 处理结果在 approvalGate 返回前保持 pending；approve/adjust 返回普通工具结果让
 * 模型继续（adjust 会引导模型重新生成计划），cancel/expired 返回 termination，
 * 由工具编排器结束当前流。
 */

import { randomUUID } from 'node:crypto'
import {
  parseResearchPlanArgs,
  RESEARCH_PLAN_TOOL_DEFINITION,
  type ResearchPlanPayload,
} from '../research-plan-tool'
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
    return RESEARCH_PLAN_TOOL_DEFINITION
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
