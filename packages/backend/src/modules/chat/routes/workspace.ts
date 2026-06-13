import type { Hono } from 'hono'
import { actorMiddleware } from '../../../middleware/auth'
import type { Actor, ApiResponse } from '../../../types'
import { ChatServiceError, type ChatService } from '../../../services/chat'
import { extendAnonymousSession } from '../chat-common'
import {
  type ArtifactService,
} from '../../../services/workspace/artifact-service'
import {
  type WorkspaceService,
} from '../../../services/workspace/workspace-service'
import { WorkspaceServiceError } from '../../../services/workspace/workspace-errors'
import type { PrismaClient } from '@prisma/client'
import path from 'node:path'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

import { MAX_WORKSPACE_FILE_SIZE } from '@aichat/shared/workspace-files'
const ALLOWED_WORKSPACE_FILENAME = /^[^<>:"/\\|?*\x00-\x1f]+$/u

export interface ChatWorkspaceRoutesDeps {
  prisma: PrismaClient
  chatService: ChatService
  artifactService: ArtifactService
  workspaceService: WorkspaceService
}

const ensureWorkspaceAccess = async (
  actor: Actor,
  sessionId: number,
  deps: { prisma: PrismaClient; chatService: ChatService },
) => {
  if (actor.type === 'user' && actor.role === 'ADMIN') {
    const exists = await deps.prisma.chatSession.findUnique({ where: { id: sessionId }, select: { id: true } })
    if (!exists) {
      throw new ChatServiceError('Chat session not found', 404)
    }
    return
  }
  await deps.chatService.ensureSessionAccess(actor, sessionId)
}

export const registerChatWorkspaceRoutes = (router: Hono, deps: ChatWorkspaceRoutesDeps) => {
  const { prisma, chatService, artifactService, workspaceService } = deps

  router.get('/sessions/:sessionId/artifacts', actorMiddleware, async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const sessionId = Number(c.req.param('sessionId'))
      const messageIdRaw = c.req.query('messageId')
      const messageId = messageIdRaw ? Number(messageIdRaw) : undefined

      if (!Number.isFinite(sessionId) || sessionId <= 0) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid session ID' }, 400)
      }

      if (typeof messageId !== 'undefined' && (!Number.isFinite(messageId) || messageId <= 0)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid message ID' }, 400)
      }

      await ensureWorkspaceAccess(actor, sessionId, { prisma, chatService })
      const artifacts = await artifactService.listSessionArtifacts(actor, sessionId, messageId)
      await extendAnonymousSession(actor, sessionId)

      return c.json<ApiResponse<{ artifacts: typeof artifacts }>>({
        success: true,
        data: {
          artifacts,
        },
      })
    } catch (error) {
      if (error instanceof ChatServiceError || error instanceof WorkspaceServiceError) {
        return c.json<ApiResponse>({ success: false, error: error.message }, error.statusCode as any)
      }
      return c.json<ApiResponse>({ success: false, error: 'Failed to list artifacts' }, 500)
    }
  })

  // 上传文件到会话 workspace（直接写入，不走分块嵌入管线）
  router.post('/sessions/:sessionId/files', actorMiddleware, async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const sessionId = Number(c.req.param('sessionId'))

      if (!Number.isFinite(sessionId) || sessionId <= 0) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid session ID' }, 400)
      }

      await ensureWorkspaceAccess(actor, sessionId, { prisma, chatService })

      const formData = await c.req.formData()
      const file = formData.get('file')
      if (!file || typeof file !== 'object' || !('name' in file) || !('arrayBuffer' in file)) {
        return c.json<ApiResponse>({ success: false, error: 'No file provided' }, 400)
      }
      const fileObj = file as unknown as { name: string; size: number; type: string; arrayBuffer(): Promise<ArrayBuffer> }

      const originalName = fileObj.name || 'untitled'
      if (!ALLOWED_WORKSPACE_FILENAME.test(originalName)) {
        return c.json<ApiResponse>({ success: false, error: '文件名包含不允许的字符' }, 400)
      }

      // 拒绝路径穿越（. / .. 等）
      const sanitized = path.basename(originalName)
      if (sanitized === '.' || sanitized === '..' || sanitized !== originalName) {
        return c.json<ApiResponse>({ success: false, error: '文件名不允许包含路径分隔符' }, 400)
      }

      if (fileObj.size > MAX_WORKSPACE_FILE_SIZE) {
        return c.json<ApiResponse>({ success: false, error: `文件超过 ${Math.round(MAX_WORKSPACE_FILE_SIZE / 1024 / 1024)}MB 限制` }, 413)
      }

      const workspace = await workspaceService.ensureWorkspace(sessionId)
      // 写入 workspace/input/ 目录，如果有同名文件则追加 uuid
      let targetName = sanitized
      let targetPath = path.resolve(workspace.inputPath, targetName)
      // 确保解析后的路径仍在 workspace.inputPath 内
      if (!targetPath.startsWith(path.resolve(workspace.inputPath) + path.sep) && targetPath !== path.resolve(workspace.inputPath)) {
        return c.json<ApiResponse>({ success: false, error: '文件名无效' }, 400)
      }
      const exists = await fs.access(targetPath).then(() => true).catch(() => false)
      if (exists) {
        const ext = path.extname(sanitized)
        const base = path.basename(sanitized, ext)
        targetName = `${base}_${randomUUID().slice(0, 8)}${ext}`
        targetPath = path.resolve(workspace.inputPath, targetName)
        if (!targetPath.startsWith(path.resolve(workspace.inputPath) + path.sep) && targetPath !== path.resolve(workspace.inputPath)) {
          return c.json<ApiResponse>({ success: false, error: '文件名无效' }, 400)
        }
      }

      const currentSize = await workspaceService.computeWorkspaceSizeBytes(workspace.rootPath)
      if (currentSize + fileObj.size > workspaceService.getConfig().maxWorkspaceBytes) {
        return c.json<ApiResponse>({ success: false, error: '工作区空间不足' }, 413)
      }

      const buffer = Buffer.from(await fileObj.arrayBuffer())
      try {
        await fs.writeFile(targetPath, buffer, { flag: 'wx' })
      } catch (err: any) {
        if (err?.code === 'EEXIST') {
          const ext = path.extname(targetName)
          const base = path.basename(targetName, ext)
          targetName = `${base}_${randomUUID().slice(0, 8)}${ext}`
          targetPath = path.resolve(workspace.inputPath, targetName)
          if (!targetPath.startsWith(path.resolve(workspace.inputPath) + path.sep) && targetPath !== path.resolve(workspace.inputPath)) {
            throw err
          }
          await fs.writeFile(targetPath, buffer, { flag: 'wx' })
        } else {
          throw err
        }
      }

      const relativePath = path.relative(workspace.rootPath, targetPath).split(path.sep).join('/')

      await extendAnonymousSession(actor, sessionId)

      return c.json<ApiResponse>({
        success: true,
        data: {
          filename: targetName,
          originalName,
          mimeType: fileObj.type || 'application/octet-stream',
          fileSize: fileObj.size,
          workspacePath: relativePath,
        },
      })
    } catch (error) {
      if (error instanceof ChatServiceError || error instanceof WorkspaceServiceError) {
        return c.json<ApiResponse>({ success: false, error: error.message }, error.statusCode as any)
      }
      return c.json<ApiResponse>({ success: false, error: 'Failed to upload file' }, 500)
    }
  })

  // 删除 workspace 中单个文件
  router.delete('/sessions/:sessionId/files', actorMiddleware, async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const sessionId = Number(c.req.param('sessionId'))
      const filePath = c.req.query('path')

      if (!Number.isFinite(sessionId) || sessionId <= 0) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid session ID' }, 400)
      }
      if (!filePath || typeof filePath !== 'string') {
        return c.json<ApiResponse>({ success: false, error: 'Missing file path' }, 400)
      }

      await ensureWorkspaceAccess(actor, sessionId, { prisma, chatService })

      const workspace = await workspaceService.ensureWorkspace(sessionId)
      const resolved = path.resolve(workspace.rootPath, filePath)

      // 安全校验：确保路径在 workspace 内且不在受保护目录之外
      if (!resolved.startsWith(path.resolve(workspace.inputPath) + path.sep) && resolved !== path.resolve(workspace.inputPath)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid file path' }, 403)
      }

      await fs.rm(resolved, { force: true }).catch(() => {})
      await extendAnonymousSession(actor, sessionId)

      return c.json<ApiResponse>({ success: true })
    } catch (error) {
      if (error instanceof ChatServiceError || error instanceof WorkspaceServiceError) {
        return c.json<ApiResponse>({ success: false, error: error.message }, error.statusCode as any)
      }
      return c.json<ApiResponse>({ success: false, error: 'Failed to delete file' }, 500)
    }
  })

  router.delete('/sessions/:sessionId/workspace', actorMiddleware, async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const sessionId = Number(c.req.param('sessionId'))

      if (!Number.isFinite(sessionId) || sessionId <= 0) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid session ID' }, 400)
      }

      await ensureWorkspaceAccess(actor, sessionId, { prisma, chatService })
      await artifactService.cleanupArtifactsBySession(sessionId)
      await workspaceService.destroyWorkspace(sessionId)
      await extendAnonymousSession(actor, sessionId)

      return c.json<ApiResponse>({
        success: true,
      })
    } catch (error) {
      if (error instanceof ChatServiceError || error instanceof WorkspaceServiceError) {
        return c.json<ApiResponse>({ success: false, error: error.message }, error.statusCode as any)
      }
      return c.json<ApiResponse>({ success: false, error: 'Failed to delete workspace' }, 500)
    }
  })
}
