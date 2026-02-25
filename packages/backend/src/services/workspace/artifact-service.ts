import { createHmac, createHash, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db'
import { getAppConfig, type WorkspaceConfig } from '../../config/app-config'
import type { Actor } from '../../types'
import { WorkspaceServiceError } from './workspace-errors'
import {
  ensureArtifactRelativePath,
  resolveWorkspacePath,
  safeFileNameFromRelativePath,
} from './workspace-path'

const DEFAULT_MIME = 'application/octet-stream'

const MIME_BY_EXTENSION: Record<string, string> = {
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xml': 'application/xml',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
}

const toUnixSeconds = (date: Date) => Math.max(0, Math.floor(date.getTime() / 1000))

const sha256ForBuffer = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex')

const mimeTypeFromFileName = (fileName: string) => {
  const extension = path.extname(fileName || '').toLowerCase()
  return MIME_BY_EXTENSION[extension] || DEFAULT_MIME
}

const isSessionAccessibleByActor = (
  actor: Actor,
  owner: { userId: number | null; anonymousKey: string | null },
) => {
  if (actor.type === 'user') {
    if (actor.role === 'ADMIN') return true
    return owner.userId != null && owner.userId === actor.id
  }
  return owner.anonymousKey != null && owner.anonymousKey === actor.key
}

export interface ArtifactServiceDeps {
  prisma?: PrismaClient
  workspaceConfig?: WorkspaceConfig
}

export interface ArtifactDescriptor {
  id: number
  fileName: string
  mimeType: string
  sizeBytes: number
  expiresAt: string
  downloadUrl: string
}

export interface ArtifactDiscoveryFile {
  absolutePath: string
  relativePath: string
}

export interface ArtifactDownloadPayload {
  absolutePath: string
  fileName: string
  mimeType: string
  sizeBytes: number
}

export class ArtifactService {
  private readonly prisma: PrismaClient
  private readonly config: WorkspaceConfig

  constructor(deps: ArtifactServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.config = deps.workspaceConfig ?? getAppConfig().workspace
  }

  buildSignature(artifactId: number, expUnix: number): string {
    const payload = `${artifactId}:${expUnix}`
    return createHmac('sha256', this.config.artifactSigningSecret)
      .update(payload)
      .digest('hex')
  }

  buildDownloadUrl(artifactId: number, expiresAt: Date): string {
    const exp = toUnixSeconds(expiresAt)
    const sig = this.buildSignature(artifactId, exp)
    return `/api/artifacts/${artifactId}/download?exp=${exp}&sig=${sig}`
  }

  verifySignature(artifactId: number, expUnix: number, signature: string): boolean {
    const expected = this.buildSignature(artifactId, expUnix)
    const provided = (signature || '').trim().toLowerCase()
    if (!expected || !provided || expected.length !== provided.length) {
      return false
    }
    try {
      return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(provided, 'utf8'))
    } catch {
      return false
    }
  }

  async listSessionArtifacts(
    actor: Actor,
    sessionId: number,
    messageId?: number,
  ): Promise<Array<ArtifactDescriptor & { messageId: number | null; expired: boolean }>> {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: { userId: true, anonymousKey: true },
    })
    if (!session || !isSessionAccessibleByActor(actor, session)) {
      throw new WorkspaceServiceError('无权访问该会话 artifact', 403, 'ARTIFACT_ACCESS_DENIED')
    }

    const records = await this.prisma.workspaceArtifact.findMany({
      where: {
        sessionId,
        ...(typeof messageId === 'number' ? { messageId } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })

    const now = Date.now()
    return records.map((record) => {
      const expired =
        Boolean(record.deletedAt) ||
        new Date(record.expiresAt).getTime() <= now
      return {
        id: record.id,
        fileName: record.fileName,
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes,
        expiresAt: record.expiresAt.toISOString(),
        downloadUrl: this.buildDownloadUrl(record.id, record.expiresAt),
        messageId: record.messageId ?? null,
        expired,
      }
    })
  }

  async publishDiscoveredFiles(params: {
    workspaceSessionId: number
    sessionId: number
    workspaceRoot: string
    messageId: number | null
    files: ArtifactDiscoveryFile[]
  }): Promise<ArtifactDescriptor[]> {
    const now = Date.now()
    const ttlMs = this.config.artifactTtlMinutes * 60_000
    const expiresAt = new Date(now + ttlMs)
    const maxCount = this.config.maxArtifactsPerMessage
    const unique = new Map<string, ArtifactDiscoveryFile>()

    for (const item of params.files) {
      const relativePath = ensureArtifactRelativePath(item.relativePath)
      if (!unique.has(relativePath)) {
        unique.set(relativePath, {
          absolutePath: item.absolutePath,
          relativePath,
        })
      }
      if (unique.size >= maxCount) break
    }

    const published: ArtifactDescriptor[] = []
    const workspaceRoot = path.resolve(params.workspaceRoot)

    for (const file of unique.values()) {
      const resolved = await resolveWorkspacePath(workspaceRoot, file.relativePath, {
        requireExists: true,
        allowRoot: false,
      })

      const stat = await fs.stat(resolved.absolutePath).catch(() => null)
      if (!stat || !stat.isFile()) continue
      if (stat.size <= 0) continue
      if (stat.size > this.config.maxArtifactBytes) {
        continue
      }

      const content = await fs.readFile(resolved.absolutePath)
      const sha256 = sha256ForBuffer(content)
      const fileName = safeFileNameFromRelativePath(file.relativePath)
      const mimeType = mimeTypeFromFileName(fileName)

      const existing = await this.prisma.workspaceArtifact.findFirst({
        where: {
          workspaceSessionId: params.workspaceSessionId,
          relativePath: file.relativePath,
          sha256,
          deletedAt: null,
        },
      })

      const record = existing
        ? await this.prisma.workspaceArtifact.update({
            where: { id: existing.id },
            data: {
              messageId: params.messageId,
              fileName,
              mimeType,
              sizeBytes: stat.size,
              expiresAt,
            },
          })
        : await this.prisma.workspaceArtifact.create({
            data: {
              workspaceSessionId: params.workspaceSessionId,
              sessionId: params.sessionId,
              messageId: params.messageId,
              relativePath: file.relativePath,
              fileName,
              mimeType,
              sizeBytes: stat.size,
              sha256,
              expiresAt,
            },
          })

      published.push({
        id: record.id,
        fileName: record.fileName,
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes,
        expiresAt: record.expiresAt.toISOString(),
        downloadUrl: this.buildDownloadUrl(record.id, record.expiresAt),
      })
    }

    return published
  }

  async resolveDownload(params: {
    actor: Actor
    artifactId: number
    expUnix: number
    signature: string
  }): Promise<ArtifactDownloadPayload> {
    const record = await this.prisma.workspaceArtifact.findUnique({
      where: { id: params.artifactId },
      include: {
        session: {
          select: {
            userId: true,
            anonymousKey: true,
          },
        },
        workspaceSession: {
          select: {
            rootPath: true,
          },
        },
      },
    })

    if (!record) {
      throw new WorkspaceServiceError('artifact 不存在', 404, 'ARTIFACT_NOT_FOUND')
    }

    if (!isSessionAccessibleByActor(params.actor, record.session)) {
      throw new WorkspaceServiceError('无权下载该 artifact', 403, 'ARTIFACT_ACCESS_DENIED')
    }

    if (!Number.isFinite(params.expUnix) || params.expUnix <= 0) {
      throw new WorkspaceServiceError('下载参数无效', 403, 'ARTIFACT_SIGNATURE_INVALID')
    }

    if (!this.verifySignature(record.id, params.expUnix, params.signature)) {
      throw new WorkspaceServiceError('下载签名无效', 403, 'ARTIFACT_SIGNATURE_INVALID')
    }

    const nowUnix = toUnixSeconds(new Date())
    const artifactExpUnix = toUnixSeconds(record.expiresAt)
    if (params.expUnix > artifactExpUnix) {
      throw new WorkspaceServiceError('下载链接无效', 403, 'ARTIFACT_SIGNATURE_INVALID')
    }

    if (nowUnix > params.expUnix || nowUnix > artifactExpUnix || record.deletedAt) {
      throw new WorkspaceServiceError('artifact 已过期', 410, 'ARTIFACT_EXPIRED')
    }

    const workspaceRoot = path.resolve(record.workspaceSession.rootPath)
    const relativePath = ensureArtifactRelativePath(record.relativePath)
    const resolved = await resolveWorkspacePath(workspaceRoot, relativePath, {
      requireExists: true,
      allowRoot: false,
    })

    const stat = await fs.stat(resolved.absolutePath).catch(() => null)
    if (!stat || !stat.isFile()) {
      throw new WorkspaceServiceError('artifact 文件不存在', 404, 'ARTIFACT_NOT_FOUND')
    }

    return {
      absolutePath: resolved.absolutePath,
      fileName: record.fileName,
      mimeType: record.mimeType,
      sizeBytes: stat.size,
    }
  }

  async cleanupExpiredArtifacts(now = new Date()): Promise<number> {
    const expired = await this.prisma.workspaceArtifact.findMany({
      where: {
        deletedAt: null,
        expiresAt: { lte: now },
      },
      include: {
        workspaceSession: {
          select: {
            rootPath: true,
          },
        },
      },
      take: 500,
    })

    if (expired.length === 0) return 0

    for (const record of expired) {
      const root = path.resolve(record.workspaceSession.rootPath)
      const relativePath = ensureArtifactRelativePath(record.relativePath)
      const absolutePath = path.resolve(root, relativePath)
      await fs.rm(absolutePath, { force: true }).catch(() => {})
    }

    const ids = expired.map((item) => item.id)
    await this.prisma.workspaceArtifact.updateMany({
      where: { id: { in: ids } },
      data: { deletedAt: now },
    })

    return ids.length
  }

  async cleanupArtifactsBySession(sessionId: number): Promise<number> {
    const records = await this.prisma.workspaceArtifact.findMany({
      where: { sessionId, deletedAt: null },
      include: {
        workspaceSession: { select: { rootPath: true } },
      },
    })

    for (const record of records) {
      const root = path.resolve(record.workspaceSession.rootPath)
      const relativePath = ensureArtifactRelativePath(record.relativePath)
      const absolutePath = path.resolve(root, relativePath)
      await fs.rm(absolutePath, { force: true }).catch(() => {})
    }

    if (records.length > 0) {
      await this.prisma.workspaceArtifact.updateMany({
        where: { id: { in: records.map((item) => item.id) } },
        data: { deletedAt: new Date() },
      })
    }

    return records.length
  }

  static async snapshotArtifactTree(workspaceArtifactsRoot: string): Promise<Map<string, string>> {
    const root = path.resolve(workspaceArtifactsRoot)
    const snapshot = new Map<string, string>()

    const walk = async (current: string) => {
      const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        const absolute = path.resolve(current, entry.name)
        if (entry.isDirectory()) {
          await walk(absolute)
          continue
        }
        if (!entry.isFile()) continue
        const rel = path.relative(root, absolute).split(path.sep).join('/')
        if (!rel) continue
        const content = await fs.readFile(absolute)
        snapshot.set(`artifacts/${rel}`, sha256ForBuffer(content))
      }
    }

    await walk(root)
    return snapshot
  }

  static diffArtifactSnapshot(
    previous: Map<string, string>,
    current: Map<string, string>,
  ): string[] {
    const changed: string[] = []
    for (const [relativePath, sha] of current.entries()) {
      const prev = previous.get(relativePath)
      if (!prev || prev !== sha) {
        changed.push(relativePath)
      }
    }
    return changed.sort((a, b) => a.localeCompare(b))
  }
}

let artifactService = new ArtifactService()

export const setArtifactService = (service: ArtifactService) => {
  artifactService = service
}

export { artifactService, MIME_BY_EXTENSION }
