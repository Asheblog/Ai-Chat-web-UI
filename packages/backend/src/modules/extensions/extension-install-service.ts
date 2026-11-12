import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db'
import type { McpService } from '../../services/mcp'
import { probeRepository } from './github-probe'
import { detectExtensionPlan } from './detector'
import { parseExtensionSource, ExtensionSourceError } from './source-parser'
import { ExtensionInstaller, type SkillInstallerLike } from './extension-installer'
import type { ExtensionInstallRequest, ExtensionInstallServiceLike, InstallOutcome } from './types'

export interface ExtensionInstallServiceDeps {
  prisma?: PrismaClient
  installer?: ExtensionInstaller
  mcpService?: McpService
  skillInstaller?: SkillInstallerLike
}

export type ExtensionInstallStage = 'parse' | 'probe' | 'detect' | 'install' | 'verify'

export type InstallFromSourceInput = ExtensionInstallRequest

export interface ActorExtensionCapability {
  isAdmin: boolean
  active: boolean
}

/**
 * 安装编排：解析 → 探测 → 判定 → 安装。
 * 权限判定放这里，工具层只负责收发消息。
 */
export class ExtensionInstallService implements ExtensionInstallServiceLike {
  private prisma: PrismaClient
  private installer: ExtensionInstaller

  constructor(deps: ExtensionInstallServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.installer = deps.installer ?? new ExtensionInstaller({
      prisma: this.prisma,
      mcpService: deps.mcpService,
      skillInstaller: deps.skillInstaller,
    })
  }

  async loadActorCapability(userId: number): Promise<ActorExtensionCapability> {
    const user = await (this.prisma as any).user.findUnique({
      where: { id: userId },
      select: { role: true, status: true },
    })
    if (!user) return { isAdmin: false, active: false }
    return { isAdmin: user.role === 'ADMIN', active: user.status !== 'DISABLED' }
  }

  async installFromSource(input: InstallFromSourceInput): Promise<InstallOutcome> {
    const kindHint = input.kindHint ?? 'auto'
    const scope = input.scope ?? 'user'
    const enable = input.enable !== false

    const capability = await this.loadActorCapability(input.actorUserId)
    if (!capability.active) {
      return { ok: false, error: '当前账号不可用，不能安装扩展' }
    }
    if (scope === 'system' && !capability.isAdmin) {
      return { ok: false, error: '只有管理员可以安装系统级扩展；可改用 scope=user' }
    }

    input.onProgress?.('parse', '解析安装源')
    let source
    try {
      source = parseExtensionSource(input.source)
    } catch (error) {
      const message = error instanceof ExtensionSourceError ? error.message : '安装源解析失败'
      return { ok: false, error: message }
    }

    input.onProgress?.('probe', `读取 ${source.owner}/${source.repo} 的清单文件`)
    let probe
    try {
      probe = await probeRepository(source, [
        'SKILL.md',
        'skill.md',
        'server.json',
        'mcp.json',
        'smithery.yaml',
        'smithery.yml',
        'package.json',
        'pyproject.toml',
        'README.md',
        'readme.md',
      ])
    } catch (error) {
      return { ok: false, error: (error as Error)?.message ?? '读取仓库失败' }
    }

    input.onProgress?.('detect', '判定扩展类型与运行方式')
    const detection = detectExtensionPlan({ source: { ...source, ref: source.ref ?? probe.ref }, probe, kindHint })

    if (detection.status === 'ambiguous') {
      return {
        ok: false,
        candidates: detection.candidates,
        error: detection.message ?? '该仓库同时包含 MCP 与 Skill，请确认要安装哪一个',
      }
    }
    if (detection.status === 'unsupported' || !detection.plan) {
      return { ok: false, error: detection.message ?? '未能识别出可安装的扩展' }
    }

    input.onProgress?.('install', `安装 ${detection.plan.kind === 'skill' ? 'Skill' : 'MCP 服务'}`)
    const outcome = await this.installer.install({
      plan: detection.plan,
      actorUserId: input.actorUserId,
      actorIsAdmin: capability.isAdmin,
      scope,
      enable,
      sessionId: input.sessionId ?? null,
    })

    input.onProgress?.('verify', outcome.status ? `完成：${outcome.status}` : '安装失败')
    return outcome
  }
}
