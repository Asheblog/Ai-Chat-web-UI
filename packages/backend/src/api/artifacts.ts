import { Hono } from 'hono'
import fs from 'node:fs'
import { Readable } from 'node:stream'
import { actorMiddleware } from '../middleware/auth'
import type { Actor, ApiResponse } from '../types'
import { artifactService } from '../services/workspace/artifact-service'
import { WorkspaceServiceError } from '../services/workspace/workspace-errors'

const buildContentDisposition = (fileName: string) => {
  const fallback = (fileName || 'artifact').replace(/[\r\n\"]/g, '')
  const encoded = encodeURIComponent(fallback)
  return `attachment; filename=\"${fallback}\"; filename*=UTF-8''${encoded}`
}

export const createArtifactsApi = () => {
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

export default createArtifactsApi()
