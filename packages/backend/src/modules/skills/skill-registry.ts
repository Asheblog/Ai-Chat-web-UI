import { randomUUID } from 'node:crypto'
import type { IToolHandler, ToolCall, ToolCallContext, ToolDefinition, ToolHandlerFactoryParams, ToolHandlerResult } from '../chat/tool-handlers/types'
import { createToolHandlerRegistry, ToolHandlerRegistry } from '../chat/tool-handlers'
import { prisma as defaultPrisma } from '../../db'
import { resolveSkillPolicy } from './skill-policy-engine'
import { skillApprovalService } from './skill-approval-service'
import { executeSkillRuntime } from './runtime-adapters'
import { normalizeRequestedSkills, type RequestedSkillsPayload, type SkillManifest, type SkillRiskLevel } from './types'

interface InstalledSkillHandlerOptions {
  prisma: typeof defaultPrisma
  skillId: number
  skillSlug: string
  skillVersionId: number
  riskLevel: SkillRiskLevel
  manifest: SkillManifest
  packagePath: string
  entry: string
  tool: SkillManifest['tools'][number]
  bindingPolicy?: Record<string, unknown> | null
}

class InstalledSkillToolHandler implements IToolHandler {
  readonly toolName: string
  readonly toolDefinition: ToolDefinition

  private prisma: typeof defaultPrisma
  private skillId: number
  private skillSlug: string
  private skillVersionId: number
  private riskLevel: SkillRiskLevel
  private manifest: SkillManifest
  private packagePath: string
  private entry: string
  private tool: SkillManifest['tools'][number]
  private bindingPolicy?: Record<string, unknown> | null

  constructor(options: InstalledSkillHandlerOptions) {
    this.prisma = options.prisma
    this.skillId = options.skillId
    this.skillSlug = options.skillSlug
    this.skillVersionId = options.skillVersionId
    this.riskLevel = options.riskLevel
    this.manifest = options.manifest
    this.packagePath = options.packagePath
    this.entry = options.entry
    this.tool = options.tool
    this.bindingPolicy = options.bindingPolicy
    this.toolName = this.tool.name
    this.toolDefinition = {
      type: 'function',
      function: {
        name: this.tool.name,
        description: this.tool.description,
        parameters: this.tool.input_schema as any,
      },
    }
  }

  canHandle(toolName: string): boolean {
    return toolName === this.toolName || (Array.isArray(this.tool.aliases) && this.tool.aliases.includes(toolName))
  }

  async handle(
    toolCall: ToolCall,
    args: Record<string, unknown>,
    context: ToolCallContext,
  ): Promise<ToolHandlerResult> {
    const callId = toolCall.id || randomUUID()
    const requestPayload = {
      args,
      tool: this.toolName,
      skill: this.skillSlug,
      sessionId: context.sessionId,
      messageId: context.messageId ?? null,
      battleRunId: context.battleRunId ?? null,
    }

    context.sendToolEvent({
      id: callId,
      tool: this.toolName,
      stage: 'start',
      summary: `执行技能 ${this.skillSlug}/${this.toolName}`,
      details: {
        skillSlug: this.skillSlug,
        skillVersionId: this.skillVersionId,
      },
    })

    let approvalStatus: 'approved' | 'denied' | 'expired' | 'skipped' = 'skipped'

    try {
      const sessionApproved = context.sessionId > 0
        ? await skillApprovalService.hasSessionApprovedSkill(context.sessionId, this.skillId)
        : false

      const policy = resolveSkillPolicy({
        riskLevel: this.riskLevel,
        policy: this.bindingPolicy,
        hasSessionApprovedBefore: sessionApproved,
      })

      if (policy.decision === 'deny') {
        const message = `技能策略拒绝执行：${policy.reason}`
        context.sendToolEvent({
          id: callId,
          tool: this.toolName,
          stage: 'error',
          error: message,
          details: { skillSlug: this.skillSlug },
        })
        await this.writeAudit({
          context,
          toolCallId: callId,
          requestPayload,
          responsePayload: { error: message },
          approvalStatus,
          error: message,
          durationMs: 0,
        })
        return this.buildErrorResult(toolCall, callId, message)
      }

      if (policy.decision === 'require_approval') {
        if (!context.sendStreamEvent) {
          const message = '当前执行上下文不支持审批交互，已拒绝该高风险技能调用'
          context.sendToolEvent({ id: callId, tool: this.toolName, stage: 'error', error: message })
          await this.writeAudit({
            context,
            toolCallId: callId,
            requestPayload,
            responsePayload: { error: message },
            approvalStatus,
            error: message,
            durationMs: 0,
          })
          return this.buildErrorResult(toolCall, callId, message)
        }

        const approvalRequest = await skillApprovalService.createRequest({
          skillId: this.skillId,
          versionId: this.skillVersionId,
          sessionId: context.sessionId > 0 ? context.sessionId : null,
          battleRunId: context.battleRunId ?? null,
          messageId: context.messageId ?? null,
          toolName: this.toolName,
          toolCallId: callId,
          reason: policy.reason,
          requestPayloadJson: JSON.stringify(requestPayload),
          requestedByActor: context.actorIdentifier || 'unknown',
          expiresInMs: 90_000,
        })

        context.sendStreamEvent({
          type: 'skill_approval_request',
          requestId: approvalRequest.id,
          skillId: this.skillId,
          skillSlug: this.skillSlug,
          skillVersionId: this.skillVersionId,
          tool: this.toolName,
          toolCallId: callId,
          reason: policy.reason,
          expiresAt: approvalRequest.expiresAt,
        })

        const decision = await skillApprovalService.waitForDecision({
          requestId: approvalRequest.id,
          timeoutMs: 95_000,
        })
        approvalStatus = decision

        context.sendStreamEvent({
          type: 'skill_approval_result',
          requestId: approvalRequest.id,
          skillId: this.skillId,
          skillSlug: this.skillSlug,
          tool: this.toolName,
          toolCallId: callId,
          decision,
        })

        if (decision !== 'approved') {
          const message = `技能审批未通过：${decision}`
          context.sendToolEvent({
            id: callId,
            tool: this.toolName,
            stage: 'error',
            error: message,
          })
          await this.writeAudit({
            context,
            toolCallId: callId,
            requestPayload,
            responsePayload: { error: message },
            approvalStatus,
            error: message,
            durationMs: 0,
            approvalRequestId: approvalRequest.id,
          })
          return this.buildErrorResult(toolCall, callId, message)
        }
      }

      const startedAt = Date.now()
      const runtimeResult = await executeSkillRuntime({
        runtime: this.manifest.runtime,
        packageRoot: this.packagePath,
        entry: this.entry,
        input: requestPayload,
        actorUserId: context.actorUserId ?? null,
        skillId: this.skillId,
        versionId: this.skillVersionId,
        timeoutMs: this.manifest.runtime.timeout_ms,
        maxOutputChars: this.manifest.runtime.max_output_chars,
      })
      const durationMs = Math.max(0, Date.now() - startedAt)

      if ((runtimeResult.exitCode ?? 0) !== 0) {
        const message = runtimeResult.stderr.trim() || `Skill runtime exited with code ${runtimeResult.exitCode}`
        context.sendToolEvent({
          id: callId,
          tool: this.toolName,
          stage: 'error',
          error: message,
          details: {
            stdout: runtimeResult.stdout,
            stderr: runtimeResult.stderr,
            exitCode: runtimeResult.exitCode,
            durationMs: runtimeResult.durationMs,
            truncated: runtimeResult.truncated,
            autoInstalledRequirements: runtimeResult.autoInstalledRequirements,
          },
        })
        await this.writeAudit({
          context,
          toolCallId: callId,
          requestPayload,
          responsePayload: {
            stdout: runtimeResult.stdout,
            stderr: runtimeResult.stderr,
            exitCode: runtimeResult.exitCode,
          },
          approvalStatus,
          error: message,
          durationMs,
        })
        return this.buildErrorResult(toolCall, callId, message)
      }

      const parsedOutput = parseRuntimeOutput(runtimeResult.stdout)
      context.sendToolEvent({
        id: callId,
        tool: this.toolName,
        stage: 'result',
        summary: `技能 ${this.skillSlug}/${this.toolName} 执行完成`,
        details: {
          exitCode: runtimeResult.exitCode,
          durationMs: runtimeResult.durationMs,
          truncated: runtimeResult.truncated,
          autoInstalledRequirements: runtimeResult.autoInstalledRequirements,
        },
      })

      await this.writeAudit({
        context,
        toolCallId: callId,
        requestPayload,
        responsePayload: parsedOutput,
        approvalStatus,
        durationMs,
      })

      return {
        toolCallId: callId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: this.toolName,
          content: JSON.stringify(parsedOutput),
        },
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Skill execution failed'
      context.sendToolEvent({
        id: callId,
        tool: this.toolName,
        stage: 'error',
        error: message,
      })
      await this.writeAudit({
        context,
        toolCallId: callId,
        requestPayload,
        responsePayload: { error: message },
        approvalStatus,
        error: message,
        durationMs: 0,
      })
      return this.buildErrorResult(toolCall, callId, message)
    }
  }

  private buildErrorResult(toolCall: ToolCall, callId: string, message: string): ToolHandlerResult {
    return {
      toolCallId: callId,
      toolName: this.toolName,
      message: {
        role: 'tool',
        tool_call_id: toolCall.id,
        name: this.toolName,
        content: JSON.stringify({ error: message }),
      },
    }
  }

  private async writeAudit(input: {
    context: ToolCallContext
    toolCallId: string
    requestPayload: Record<string, unknown>
    responsePayload: Record<string, unknown>
    approvalStatus?: string
    approvalRequestId?: number
    error?: string
    durationMs: number
  }) {
    await (this.prisma as any).skillExecutionAudit.create({
      data: {
        skillId: this.skillId,
        versionId: this.skillVersionId,
        approvalRequestId: input.approvalRequestId ?? null,
        sessionId: input.context.sessionId > 0 ? input.context.sessionId : null,
        battleRunId: input.context.battleRunId ?? null,
        messageId: input.context.messageId ?? null,
        toolName: this.toolName,
        toolCallId: input.toolCallId,
        requestPayloadJson: JSON.stringify(input.requestPayload),
        responsePayloadJson: JSON.stringify(input.responsePayload),
        approvalStatus: input.approvalStatus ?? null,
        platform: process.platform,
        durationMs: input.durationMs,
        error: input.error ?? null,
      },
    })
  }
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // noop
  }
  return {}
}

function parseRuntimeOutput(stdout: string): Record<string, unknown> {
  const trimmed = (stdout || '').trim()
  if (!trimmed) {
    return { ok: true }
  }
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>
    }
    return { value: parsed }
  } catch {
    return { text: trimmed }
  }
}

function isBuiltinSkill(slug: string): boolean {
  return (
    slug === 'web-search' ||
    slug === 'python-runner' ||
    slug === 'url-reader' ||
    slug === 'document-search' ||
    slug === 'knowledge-base-search'
  )
}

function parseManifestFromVersion(manifestJson: string): SkillManifest | null {
  try {
    const parsed = JSON.parse(manifestJson)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as SkillManifest
  } catch {
    return null
  }
}

async function resolveActiveVersion(params: {
  prisma: typeof defaultPrisma
  skill: any
  binding?: any
}): Promise<any | null> {
  const { prisma, skill, binding } = params
  if (binding?.versionId) {
    const boundVersion = await (prisma as any).skillVersion.findFirst({
      where: {
        id: binding.versionId,
        skillId: skill.id,
        status: 'active',
      },
    })
    if (boundVersion) return boundVersion
  }

  if (skill.defaultVersionId) {
    const defaultVersion = await (prisma as any).skillVersion.findFirst({
      where: {
        id: skill.defaultVersionId,
        skillId: skill.id,
        status: 'active',
      },
    })
    if (defaultVersion) return defaultVersion
  }

  const latest = await (prisma as any).skillVersion.findFirst({
    where: {
      skillId: skill.id,
      status: 'active',
    },
    orderBy: [{ activatedAt: 'desc' }, { createdAt: 'desc' }],
  })
  return latest || null
}

function chooseBinding(bindings: any[]): any | null {
  if (!Array.isArray(bindings) || bindings.length === 0) return null
  const priority: Record<string, number> = {
    battle_model: 4,
    session: 3,
    user: 2,
    system: 1,
  }
  const sorted = [...bindings].sort((a, b) => (priority[b.scopeType] ?? 0) - (priority[a.scopeType] ?? 0))
  return sorted[0] || null
}

export interface CreateSkillRegistryParams {
  prisma?: typeof defaultPrisma
  builtins: ToolHandlerFactoryParams
  requestedSkills: RequestedSkillsPayload | null | undefined
  sessionId: number
  actorUserId?: number | null
  battleRunId?: number | null
  allowDynamicRuntime?: boolean
}

export async function createSkillRegistry(params: CreateSkillRegistryParams): Promise<ToolHandlerRegistry> {
  const prisma = params.prisma ?? defaultPrisma
  const requested = normalizeRequestedSkills(params.requestedSkills)
  const registry = createToolHandlerRegistry(params.builtins)
  const allowDynamicRuntime = params.allowDynamicRuntime !== false

  if (!allowDynamicRuntime) {
    return registry
  }

  const dynamicSkillSlugs = requested.enabled.filter((slug) => !isBuiltinSkill(slug))
  if (dynamicSkillSlugs.length === 0) {
    return registry
  }

  const skills = await (prisma as any).skill.findMany({
    where: {
      slug: { in: dynamicSkillSlugs },
      status: 'active',
    },
    select: {
      id: true,
      slug: true,
      displayName: true,
      defaultVersionId: true,
    },
  })

  if (skills.length === 0) {
    return registry
  }

  const bindingOr: Array<Record<string, unknown>> = [
    { scopeType: 'system', scopeId: 'global' },
    { scopeType: 'session', scopeId: String(params.sessionId) },
  ]
  if (params.actorUserId != null) {
    bindingOr.push({ scopeType: 'user', scopeId: String(params.actorUserId) })
  }
  if (params.battleRunId != null) {
    bindingOr.push({ scopeType: 'battle_model', scopeId: String(params.battleRunId) })
  }

  const skillIdList = skills.map((item: any) => item.id)
  const bindings = await (prisma as any).skillBinding.findMany({
    where: {
      skillId: { in: skillIdList },
      enabled: true,
      OR: bindingOr,
    },
    select: {
      id: true,
      skillId: true,
      versionId: true,
      scopeType: true,
      scopeId: true,
      policyJson: true,
    },
  })

  const bindingsBySkill = new Map<number, any[]>()
  for (const item of bindings) {
    const list = bindingsBySkill.get(item.skillId) ?? []
    list.push(item)
    bindingsBySkill.set(item.skillId, list)
  }

  for (const skill of skills) {
    const scopedBindings = bindingsBySkill.get(skill.id) ?? []
    const selectedBinding = chooseBinding(scopedBindings)
    const activeVersion = await resolveActiveVersion({
      prisma,
      skill,
      binding: selectedBinding,
    })
    if (!activeVersion || !activeVersion.packagePath) continue

    const manifest = parseManifestFromVersion(activeVersion.manifestJson)
    if (!manifest) continue

    const policyJson = selectedBinding?.policyJson
      ? parseJsonObject(selectedBinding.policyJson)
      : null

    for (const tool of manifest.tools || []) {
      if (!tool?.name) continue
      if (registry.hasHandler(tool.name)) continue
      registry.register(new InstalledSkillToolHandler({
        prisma,
        skillId: skill.id,
        skillSlug: skill.slug,
        skillVersionId: activeVersion.id,
        riskLevel: (activeVersion.riskLevel || manifest.risk_level || 'low') as SkillRiskLevel,
        manifest,
        packagePath: activeVersion.packagePath,
        entry: activeVersion.entry || manifest.entry,
        tool,
        bindingPolicy: policyJson,
      }))
    }
  }

  return registry
}
