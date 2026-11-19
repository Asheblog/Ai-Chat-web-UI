import { readRemoteImages } from '../../../utils/remote-image-reader'
import type { ToolImageEvidence } from '../../../utils/tool-image-evidence'
import type { AutoReadItem } from './web-search-auto-read'

const MAX_IMAGES = 3
const IMAGE_BUDGET_MS = 3_000

export async function downloadSearchImageEvidence(
  evidence: AutoReadItem[],
  requestSignal?: AbortSignal,
): Promise<ToolImageEvidence | undefined> {
  const candidates = evidence.flatMap((item) => {
    if (item.evidenceKind !== 'article' && item.evidenceKind !== 'structured') return []
    const imageUrl = item.leadImageUrl || item.images?.[0]?.url
    return imageUrl ? [{ imageUrl, sourceUrl: item.finalUrl || item.url, title: item.title || '' }] : []
  }).slice(0, MAX_IMAGES)
  if (candidates.length === 0 || requestSignal?.aborted) return undefined

  const deadline = AbortSignal.timeout(IMAGE_BUDGET_MS)
  const signal = requestSignal ? AbortSignal.any([requestSignal, deadline]) : deadline
  const downloaded = await readRemoteImages(candidates.map(({ imageUrl }) => ({ url: imageUrl })), {
    maxCount: MAX_IMAGES,
    signal,
  })
  const byUrl = new Map(downloaded.map((image) => [image.requestedUrl, image]))
  const images = candidates.flatMap((source) => {
    const image = byUrl.get(source.imageUrl)
    return image ? [{ ...source, dataUrl: `data:${image.mime};base64,${image.data}` }] : []
  })
  return images.length > 0 ? { kind: 'page', images } : undefined
}
