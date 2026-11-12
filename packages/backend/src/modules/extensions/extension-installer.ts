import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db'
import type { McpService } from '../../services/mcp'
import type { InstallOutcome, InstallPlan, InstallStatus, ExtensionEnvRequirement } from './types'
import { toNamespaceKey } from './source-parser'

export interface SkillInstallerLike {
  installFromGithub(input: {
    source: string
    actorUserId?: number | null
    token?: string
    storeItemKey?: string | null
    sourceKey?: string | null
    trustedSource?: boolean
  }): Promise<{
    skill: { id: number; slug: string; displayName: string; status: string }
    version: { id: number; version: string; status: string }
  }>
}

export interface ExtensionInstallerDeps {
  prisma?: PrismaClient
  mcpService?: McpService
  skillInstaller?: SkillInstallerLike
}

export interface InstallExtensionInput {
  plan: InstallPlan
  actorUserId: number
  actorIsAdmin: boolean
  scope: 'user' | 'system'
  enable: boolean
  sessionId?: number | null
}

const PINNED_TOOL_LIMIT = 3

function toSkillSource(plan: InstallPlan, ref: string): string {
  const base = `${plan.source.owner}/${plan.source.repo}@${ref}`
  return plan.source.subdir ? `${base}:${plan.source.subdir}` : base
}

function mapSkillStatus(status: string): InstallStatus {
  if (status === 'active') return 'ready'
  if (status === 'pending_approval') return 'pending_approval'
  return 'pending_validation'
}

/**
 * 把 InstallPlan 落成系统里的真实记录。
 *
 * Skill：复用既有安装链路（许可证 / 版本状态机 / 审批）。
 * MCP：安装模板 → 连接 → 绑定 → 刷新工具缓存；本地包走网关容器。
 * 任一步失败都要回滚，不留半装状态。
 */
export class ExtensionInstaller {
  private prisma: PrismaClient
  private mcpService?: McpService
  private skillInstaller?: SkillInstallerLike

  constructor(deps: ExtensionInstallerDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.mcpService = deps.mcpService
    this.skillInstaller = deps.skillInstaller
  }

  async install(input: InstallExtensionInput): Promise<InstallOutcome> {
    const { plan } = input
    if (plan.kind === 'skill') return this.installSkill(input)
    return this.installMcp(input)
  }

  private async installSkill(input: InstallExtensionInput): Promise<InstallOutcome> {
    const { plan, actorUserId } = input
    if (!this.skillInstaller) {
      return { ok: false, status: 'registered_unverified', plan, error: 'Skill 安装器未配置' }
    }
    const ref = plan.source.ref || 'main'
    const source = toSkillSource(plan, ref)

    let result: Awaited<ReturnType<SkillInstallerLike['installFromGithub']>>
    try {
      result = await this.skillInstaller.installFromGithub({
        source,
        actorUserId,
        token: (process.env.GITHUB_SKILL_TOKEN || '').trim() || undefined,
        trustedSource: false,
      })
    } catch (error) {
      return {
        ok: false,
        status: 'registered_unverified',
        plan,
        error: `Skill 安装失败：${(error as Error)?.message ?? 'unknown'}`,
      }
    }

    const status = mapSkillStatus(result.version.status)
    const nextSteps: string[] = []

    if (status === 'ready' && input.enable) {
      await this.bindSkillToSession(result.skill.id, result.version.id, actorUserId, input.sessionId)
      nextSteps.push(
        '已绑定到本会话；需开启「聊天侧第三方动态 Skill Runtime」后模型才能执行该 Skill',
      )
    } else if (status === 'pending_approval') {
      nextSteps.push('该 Skill 风险等级较高，需管理员在「待审批」通过后才能运行')
    } else if (status === 'pending_validation') {
      nextSteps.push('版本已安装，等待校验完成后即可启用')
    }

    return {
      ok: true,
      status,
      plan,
      installed: {
        skillId: result.skill.id,
        versionId: result.version.id,
      },
      nextSteps,
    }
  }

  private async bindSkillToSession(
    skillId: number,
    versionId: number,
    actorUserId: number,
    sessionId?: number | null,
  ): Promise<void> {
    if (!sessionId) return
    await (this.prisma as any).skillBinding.upsert({
      where: {
        skillId_scopeType_scopeId: {
          skillId,
          scopeType: 'session',
          scopeId: String(sessionId),
        },
      },
      update: {
        versionId,
        sessionId,
        enabled: true,
        createdByUserId: actorUserId,
      },
      create: {
        skillId,
        versionId,
        scopeType: 'session',
        scopeId: String(sessionId),
        sessionId,
        enabled: true,
        createdByUserId: actorUserId,
        policyJson: '{}',
        overridesJson: '{}',
      },
    })
  }

  private async installMcp(input: InstallExtensionInput): Promise<InstallOutcome> {
    const { plan, actorUserId, actorIsAdmin, scope, enable } = input
    const mcpService = this.mcpService
    if (!mcpService) {
      return { ok: false, status: 'registered_unverified', plan, error: 'MCP 服务未配置' }
    }

    // 非管理员不能用本地包型：ADR-0015 规定其在网关内运行，部署侧权限由管理员掌握
    if (!actorIsAdmin && plan.sourceType === 'local_package') {
      return {
        ok: false,
        status: 'pending_gateway',
        plan,
        error: '本地包型 MCP 只能由管理员安装（需容器网关）',
        nextSteps: ['把仓库链接交给管理员，或改用该服务提供的远程端点'],
      }
    }

    const namespaceKey = toNamespaceKey(plan.source)
    let existing = await mcpService.findInstallationByKey(namespaceKey)

    // ADR-0017：安装模板是系统级资产，只有管理员能创建；普通用户基于既有模板建自己的连接
    if (!existing && !actorIsAdmin) {
      return {
        ok: false,
        status: 'pending_approval',
        plan,
        error: 'MCP 安装模板需要管理员创建',
        nextSteps: ['请管理员先安装该模板，之后你可以在自己的范围内创建连接'],
      }
    }

    if (existing) {
      const connections = await mcpService.listConnections({ installationId: existing.id })
      const owned = connections.find((item) =>
        scope === 'system' ? item.ownerUserId === null : item.ownerUserId === actorUserId,
      )
      if (owned) {
        const tools = await mcpService.listToolCache({ connectionId: owned.id }).catch(() => [])
        return {
          ok: true,
          status: 'already_installed',
          plan,
          installed: { installationId: existing.id, connectionId: owned.id },
          tools: tools.map((tool: any) => ({ name: tool.originalName, description: tool.description ?? null })),
          nextSteps: ['该扩展已安装，本次未重复创建'],
        }
      }
    }

    const envKeys: ExtensionEnvRequirement[] = plan.envKeys ?? []
    const installation = existing ?? await mcpService.createInstallation({
      namespaceKey,
      name: plan.name,
      description: plan.reason,
      sourceType: plan.sourceType ?? (plan.transport === 'stdio' ? 'local_package' : 'remote'),
      sourceUrl: plan.sourceUrl,
      sourceKey: `${plan.source.owner}/${plan.source.repo}`,
      registrySource: 'github',
      transport: plan.transport ?? 'streamable_http',
      endpoint: plan.endpoint ?? null,
      command: plan.command ?? null,
      argsJson: JSON.stringify(plan.args ?? []),
      envJson: JSON.stringify({}),
    }, true)

    let connectionId: number | null = null
    try {
      const connection = await mcpService.createConnection({
        installationId: installation.id,
        ownerUserId: scope === 'user' ? actorUserId : null,
        name: plan.name,
        enabled: enable,
        configJson: JSON.stringify({ env: {}, headers: plan.headers ?? {}, envKeys }),
      }, actorIsAdmin)
      connectionId = connection.id

      await this.createBindings(mcpService, connection.id, scope, actorUserId, input.sessionId)

      if (!enable) {
        return {
          ok: true,
          status: 'registered_unverified',
          plan,
          installed: { installationId: installation.id, connectionId: connection.id },
          requiredSecrets: envKeys,
          nextSteps: ['已登记但未启用；确认配置后在「连接」里启用'],
        }
      }

      return await this.verifyAndPin(mcpService, {
        plan,
        installationId: installation.id,
        connectionId: connection.id,
        envKeys,
        sessionId: input.sessionId ?? null,
      })
    } catch (error) {
      await this.rollback(installation.id, connectionId, Boolean(existing))
      const message = (error as Error)?.message ?? 'unknown'
      const isGateway = (error as any)?.code === 'MCP_GATEWAY_UNAVAILABLE'
        || (error as any)?.code === 'MCP_GATEWAY_UNSUPPORTED_COMMAND'
      return {
        ok: false,
        status: isGateway ? 'pending_gateway' : 'registered_unverified',
        plan,
        error: isGateway
          ? `本地包型 MCP 需要容器网关：${message}`
          : `安装或验证失败：${message}`,
        warnings: isGateway ? ['部署侧需要可用的 docker 与 MCP_GATEWAY_* 配置'] : undefined,
      }
    }
  }

  private async createBindings(
    mcpService: McpService,
    connectionId: number,
    scope: 'user' | 'system',
    actorUserId: number,
    sessionId?: number | null,
  ): Promise<void> {
    if (scope === 'system') {
      await mcpService.bindConnection({ connectionId, scopeType: 'system', scopeId: 'system', createdBy: actorUserId })
      return
    }
    await mcpService.bindConnection({ connectionId, scopeType: 'user', scopeId: String(actorUserId), createdBy: actorUserId })
    if (sessionId) {
      await mcpService.bindConnection({ connectionId, scopeType: 'session', scopeId: String(sessionId), createdBy: actorUserId })
    }
  }

  private async verifyAndPin(
    mcpService: McpService,
    params: {
      plan: InstallPlan
      installationId: number
      connectionId: number
      envKeys: ExtensionEnvRequirement[]
      sessionId: number | null
    },
  ): Promise<InstallOutcome> {
    const { plan, installationId, connectionId, envKeys, sessionId } = params
    let tools: Array<{ name: string; description: string | null }> = []

    try {
      await mcpService.refreshToolCache(connectionId)
      const cached = await mcpService.listToolCache({ connectionId })
      tools = cached.map((tool: any) => ({ name: tool.originalName, description: tool.description ?? null }))

      if (sessionId && cached.length > 0) {
        for (const tool of cached.slice(0, PINNED_TOOL_LIMIT)) {
          await mcpService.pinTool(connectionId, tool.originalName, null).catch(() => undefined)
        }
      }
    } catch (error) {
      const message = (error as Error)?.message ?? 'unknown'
      const isGateway = (error as any)?.code === 'MCP_GATEWAY_UNAVAILABLE'
        || (error as any)?.code === 'MCP_GATEWAY_UNSUPPORTED_COMMAND'
      if (isGateway) {
        return {
          ok: true,
          status: 'pending_gateway',
          plan,
          installed: { installationId, connectionId },
          requiredSecrets: envKeys,
          nextSteps: ['已登记；部署侧提供容器网关后即可拉取工具清单'],
          warnings: [`本地包运行环境不可用：${message}`],
        }
      }
      return {
        ok: true,
        status: envKeys.length > 0 ? 'needs_secret' : 'registered_unverified',
        plan,
        installed: { installationId, connectionId },
        requiredSecrets: envKeys,
        nextSteps: envKeys.length > 0
          ? [`在「凭据」里填入 ${envKeys.map((item) => item.name).join('、')} 后刷新工具`]
          : ['连接已建立但拉取工具清单失败，可在「工具」里手动刷新'],
        warnings: [`工具清单未验证：${message}`],
      }
    }

    const nextSteps: string[] = []
    if (tools.length === 0) nextSteps.push('该服务未暴露工具，确认端点是否正确')
    else nextSteps.push(`已可用 ${tools.length} 个工具${sessionId ? '（已固定前 3 个到本会话）' : ''}`)

    return {
      ok: true,
      status: 'ready',
      plan,
      installed: { installationId, connectionId },
      tools,
      requiredSecrets: envKeys.length > 0 ? envKeys : undefined,
      nextSteps,
    }
  }

  private async rollback(installationId: number, connectionId: number | null, keepInstallation: boolean): Promise<void> {
    try {
      if (connectionId) await this.mcpService?.deleteConnection(connectionId)
      if (!keepInstallation) await this.mcpService?.deleteInstallation(installationId)
    } catch {
      // 回滚失败不覆盖原始错误
    }
  }
}
