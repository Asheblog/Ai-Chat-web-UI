import { notFound } from 'next/navigation'
import { buildDevArtifactContent } from '../../fixtures/dev-artifact-content'
import { DEV_ARTIFACT_FILES } from '../../fixtures/primitives'

/**
 * dev 下载夹具：只有 DEV_ARTIFACT_FILES 里列出的两个文件可下载，其他一律 404。
 * 生产构建不暴露该路由。
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ file: string }> },
) {
  if (process.env.NODE_ENV === 'production') notFound()

  const { file } = await context.params
  const entry = DEV_ARTIFACT_FILES.find(item => item.slug === file)
  if (!entry) notFound()

  const asciiFallback = entry.slug
  return new Response(buildDevArtifactContent(entry.slug), {
    headers: {
      'Content-Type': `${entry.mimeType}; charset=utf-8`,
      'Content-Disposition': `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(entry.fileName)}`,
      'Cache-Control': 'no-store',
    },
  })
}
