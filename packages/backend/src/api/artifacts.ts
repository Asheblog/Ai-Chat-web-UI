import { Hono } from 'hono'
import fs from 'node:fs'
import { Readable } from 'node:stream'
import { actorMiddleware } from '../middleware/auth'
import type { Actor, ApiResponse } from '../types'
import type { ArtifactService } from '../services/workspace/artifact-service'
import { WorkspaceServiceError } from '../services/workspace/workspace-errors'

const buildContentDispositionFallback = (sanitizedName: string) => {
  const extensionMatch = sanitizedName.match(/(\.[A-Za-z0-9]{1,16})$/)
  const extension = extensionMatch ? extensionMatch[1] : ''
  const ascii = sanitizedName
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[\\/;]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  const fallback = (ascii || `artifact${extension}` || 'artifact').slice(0, 180)
  return fallback
}

const buildContentDisposition = (fileName: string) => {
  const sanitized = (fileName || 'artifact').replace(/[\r\n\"]/g, '').trim() || 'artifact'
  const fallback = buildContentDispositionFallback(sanitized)
  const encoded = encodeURIComponent(sanitized)
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

export interface ArtifactsApiDeps {
  artifactService: ArtifactService
}

export const createArtifactsApi = (deps: ArtifactsApiDeps) => {
  const artifactService = deps.artifactService
  const router = new Hono()

  router.get('/:id/download', actorMiddleware, async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const artifactId = Number(c.req.param('id'))
      const expRaw = c.req.query('exp') || ''
      const sig = c.req.query('sig') || ''

      if (!Number.isFinite(artifactId) || artifactId <= 0) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid artifact id' }, 400)
      }
      const expUnix = Number(expRaw)
      if (!Number.isFinite(expUnix) || expUnix <= 0) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid exp parameter' }, 400)
      }
      if (!sig.trim()) {
        return c.json<ApiResponse>({ success: false, error: 'Missing sig parameter' }, 400)
      }

      const download = await artifactService.resolveDownload({
        actor,
        artifactId,
        expUnix,
        signature: sig,
      })

      const stat = await fs.promises.stat(download.absolutePath)
      if (!stat.isFile()) {
        return c.json<ApiResponse>({ success: false, error: 'Artifact not found' }, 404)
      }

      const nodeStream = fs.createReadStream(download.absolutePath)
      const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>
      return new Response(webStream, {
        status: 200,
        headers: {
          'Content-Type': download.mimeType || 'application/octet-stream',
          'Content-Length': String(stat.size),
          'Content-Disposition': buildContentDisposition(download.fileName),
          'Cache-Control': 'private, no-store',
        },
      })
    } catch (error) {
      if (error instanceof WorkspaceServiceError) {
        return c.json<ApiResponse>({ success: false, error: error.message }, error.statusCode as any)
      }
      return c.json<ApiResponse>({ success: false, error: 'Failed to download artifact' }, 500)
    }
  })

  return router
}

export default createArtifactsApi
