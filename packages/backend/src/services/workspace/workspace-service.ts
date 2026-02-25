import fs from 'node:fs/promises'
import path from 'node:path'
import type { PrismaClient, WorkspaceSession } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db'
import { getAppConfig, type WorkspaceConfig } from '../../config/app-config'
import { createLogger } from '../../utils/logger'
import { WorkspaceServiceError } from './workspace-errors'

const log = createLogger('WorkspaceService')

const WORKSPACE_SUBDIRS = ['input', 'repos', 'artifacts', '.venv', '.meta'] as const

const toSessionWorkspacePath = (rootDir: string, sessionId: number) =>
  path.resolve(rootDir, String(sessionId))

const ensureDirectory = async (dirPath: string) => {
  await fs.mkdir(dirPath, { recursive: true })
}

const isNumericDirectoryName = (name: string) => /^\d+$/.test(name)

export interface WorkspaceInfo {
  sessionId: number
  rootPath: string
  inputPath: string
  reposPath: string
  artifactsPath: string
  venvPath: string
  metaPath: string
  record: WorkspaceSession
}

export interface WorkspaceServiceDeps {
  prisma?: PrismaClient
  config?: WorkspaceConfig
}

export class WorkspaceService {
  private readonly prisma: PrismaClient
  private readonly config: WorkspaceConfig

  constructor(deps: WorkspaceServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.config = deps.config ?? getAppConfig().workspace
  }

  getRootDir() {
    return this.config.rootDir
  }

  getConfig() {
    return this.config
  }

  async ensureWorkspace(sessionId: number): Promise<WorkspaceInfo> {
    if (!Number.isFinite(sessionId) || sessionId <= 0) {
      throw new WorkspaceServiceError('无效的会话 ID', 400, 'WORKSPACE_SESSION_INVALID')
    }

    const sessionExists = await this.prisma.chatSession.count({ where: { id: sessionId } })
    if (sessionExists <= 0) {
      throw new WorkspaceServiceError('会话不存在', 404, 'WORKSPACE_SESSION_NOT_FOUND')
    }

    const rootPath = toSessionWorkspacePath(this.config.rootDir, sessionId)
    await ensureDirectory(this.config.rootDir)
    await ensureDirectory(rootPath)
    await Promise.all(
      WORKSPACE_SUBDIRS.map((name) => ensureDirectory(path.resolve(rootPath, name))),
    )

    const now = new Date()
    const expiresAt = new Date(now.getTime() + this.config.idleTtlMinutes * 60_000)

    const record = await this.prisma.workspaceSession.upsert({
      where: { sessionId },
      update: {
        rootPath,
        status: 'active',
        sandboxProvider: 'docker',
        lastUsedAt: now,
        expiresAt,
      },
      create: {
        sessionId,
        rootPath,
        status: 'active',
        sandboxProvider: 'docker',
        lastUsedAt: now,
        expiresAt,
      },
    })

    return {
      sessionId,
      rootPath,
      inputPath: path.resolve(rootPath, 'input'),
      reposPath: path.resolve(rootPath, 'repos'),
      artifactsPath: path.resolve(rootPath, 'artifacts'),
      venvPath: path.resolve(rootPath, '.venv'),
      metaPath: path.resolve(rootPath, '.meta'),
      record,
    }
  }

  async touchWorkspace(sessionId: number): Promise<void> {
    const now = new Date()
    const expiresAt = new Date(now.getTime() + this.config.idleTtlMinutes * 60_000)
    await this.prisma.workspaceSession.updateMany({
      where: { sessionId },
      data: {
        lastUsedAt: now,
        expiresAt,
      },
    })
  }

  async getWorkspace(sessionId: number): Promise<WorkspaceInfo | null> {
    const record = await this.prisma.workspaceSession.findUnique({ where: { sessionId } })
    if (!record) return null
    const rootPath = path.resolve(record.rootPath)
    return {
      sessionId,
      rootPath,
      inputPath: path.resolve(rootPath, 'input'),
      reposPath: path.resolve(rootPath, 'repos'),
      artifactsPath: path.resolve(rootPath, 'artifacts'),
      venvPath: path.resolve(rootPath, '.venv'),
      metaPath: path.resolve(rootPath, '.meta'),
      record,
    }
  }

  async destroyWorkspace(sessionId: number): Promise<void> {
    const existing = await this.prisma.workspaceSession.findUnique({ where: { sessionId } })
    const rootPath = existing?.rootPath
      ? path.resolve(existing.rootPath)
      : toSessionWorkspacePath(this.config.rootDir, sessionId)

    await fs.rm(rootPath, { recursive: true, force: true }).catch(() => {})

    if (existing) {
      await this.prisma.workspaceSession.deleteMany({ where: { sessionId } })
    }

    await this.prisma.workspaceArtifact.updateMany({
      where: { sessionId, deletedAt: null },
      data: { deletedAt: new Date() },
    })
  }

  async cleanupExpiredWorkspaces(now = new Date()): Promise<number> {
    const expired = await this.prisma.workspaceSession.findMany({
      where: {
        OR: [
          { expiresAt: { lte: now } },
          { status: { in: ['disabled', 'error'] } },
        ],
      },
      select: { sessionId: true },
    })

    if (expired.length === 0) return 0

    let deletedCount = 0
    for (const item of expired) {
      try {
        await this.destroyWorkspace(item.sessionId)
        deletedCount += 1
      } catch (error) {
        log.warn('failed to cleanup workspace', {
          sessionId: item.sessionId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return deletedCount
  }

  async cleanupOrphanWorkspaces(): Promise<number> {
    await ensureDirectory(this.config.rootDir)

    const [workspaceRows, sessionRows, dirEntries] = await Promise.all([
      this.prisma.workspaceSession.findMany({
        select: {
          sessionId: true,
          rootPath: true,
        },
      }),
      this.prisma.chatSession.findMany({ select: { id: true } }),
      fs.readdir(this.config.rootDir, { withFileTypes: true }).catch(() => [] as any[]),
    ])

    const sessionIdSet = new Set(sessionRows.map((item) => item.id))
    const workspaceSessionIdSet = new Set(workspaceRows.map((item) => item.sessionId))

    const danglingRows = workspaceRows.filter((item) => !sessionIdSet.has(item.sessionId))
    if (danglingRows.length > 0) {
      await this.prisma.workspaceSession.deleteMany({
        where: { sessionId: { in: danglingRows.map((item) => item.sessionId) } },
      })
    }

    let reclaimed = 0
    for (const entry of dirEntries) {
      if (!entry.isDirectory()) continue
      if (!isNumericDirectoryName(entry.name)) continue
      const sessionId = Number(entry.name)
      if (!Number.isFinite(sessionId) || sessionId <= 0) continue
      if (workspaceSessionIdSet.has(sessionId) && sessionIdSet.has(sessionId)) continue
      const dirPath = path.resolve(this.config.rootDir, entry.name)
      await fs.rm(dirPath, { recursive: true, force: true }).catch(() => {})
      reclaimed += 1
    }

    return reclaimed + danglingRows.length
  }

  async computeWorkspaceSizeBytes(rootPath: string): Promise<number> {
    const absoluteRoot = path.resolve(rootPath)
    const stack = [absoluteRoot]
    let total = 0

    while (stack.length > 0) {
      const current = stack.pop()!
      const stat = await fs.lstat(current).catch(() => null)
      if (!stat) continue

      if (stat.isSymbolicLink()) {
        continue
      }
      if (stat.isFile()) {
        total += stat.size
        if (total > this.config.maxWorkspaceBytes) {
          return total
        }
        continue
      }
      if (!stat.isDirectory()) {
        continue
      }

      const children = await fs.readdir(current, { withFileTypes: true }).catch(() => [])
      for (const child of children) {
        stack.push(path.resolve(current, child.name))
      }
    }

    return total
  }
}

let workspaceService = new WorkspaceService()

export const setWorkspaceService = (service: WorkspaceService) => {
  workspaceService = service
}

export { workspaceService }
