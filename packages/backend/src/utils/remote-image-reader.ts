import { DEFAULT_CHAT_IMAGE_LIMITS, type ChatImageLimitConfig } from '@aichat/shared/image-limits'
import { validateChatImages } from './chat-images'
import { fetchWithValidatedRedirects, validatePublicHttpUrl } from './url-reader'

export interface RemoteImageCandidate {
  url: string
  alt?: string
  width?: number
  height?: number
  source?: string
}

export interface RemoteImageReadOptions {
  timeoutMs?: number
  maxCount?: number
  limits?: ChatImageLimitConfig
  fetchImpl?: typeof fetch
}

export interface RemoteImageReadResult {
  url: string
  mime: string
  data: string
  alt?: string
  width?: number
  height?: number
  source?: string
}

const DEFAULT_TIMEOUT_MS = 12_000
const DEFAULT_MAX_COUNT = 3
const DEFAULT_LIMITS: ChatImageLimitConfig = {
  maxCount: Math.min(DEFAULT_CHAT_IMAGE_LIMITS.maxCount, DEFAULT_MAX_COUNT),
  maxMb: Math.min(DEFAULT_CHAT_IMAGE_LIMITS.maxMb, 6),
  maxEdge: DEFAULT_CHAT_IMAGE_LIMITS.maxEdge,
  maxTotalMb: Math.min(DEFAULT_CHAT_IMAGE_LIMITS.maxTotalMb, 12),
}

const sanitizeMime = (value: string | null | undefined): string | null => {
  const normalized = (value || '').trim().toLowerCase()
  if (!normalized) return null
  const mime = normalized.split(';')[0]?.trim() || ''
  return mime.startsWith('image/') ? mime : null
}

const clampCount = (value?: number): number => {
  if (!Number.isFinite(value) || (value as number) <= 0) return DEFAULT_MAX_COUNT
  return Math.max(1, Math.min(DEFAULT_MAX_COUNT, Math.floor(value as number)))
}

export async function readRemoteImages(
  candidates: RemoteImageCandidate[],
  options: RemoteImageReadOptions = {},
): Promise<RemoteImageReadResult[]> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = Number.isFinite(options.timeoutMs) && (options.timeoutMs as number) > 0
    ? Math.floor(options.timeoutMs as number)
    : DEFAULT_TIMEOUT_MS
  const maxCount = clampCount(options.maxCount)
  const limits = options.limits ?? DEFAULT_LIMITS
  const maxSingleBytes = Math.floor(limits.maxMb * 1024 * 1024)
  const maxTotalBytes = Math.floor(limits.maxTotalMb * 1024 * 1024)

  const uniqueCandidates = Array.from(
    new Map(
      (Array.isArray(candidates) ? candidates : [])
        .filter((candidate) => candidate && typeof candidate.url === 'string' && candidate.url.trim())
        .map((candidate) => [candidate.url.trim(), candidate]),
    ).values(),
  ).slice(0, maxCount)

  const downloaded: RemoteImageReadResult[] = []

  for (const candidate of uniqueCandidates) {
    let normalizedUrl = ''
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('remote image timeout')), timeoutMs)
    try {
      normalizedUrl = validatePublicHttpUrl(candidate.url)
      const response = await fetchWithValidatedRedirects(normalizedUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*;q=0.8,*/*;q=0.5',
        },
      }, fetchImpl)

      if (!response.ok) continue

      const mime = sanitizeMime(response.headers.get('content-type'))
      if (!mime) continue

      const declaredLength = Number.parseInt(response.headers.get('content-length') || '', 10)
      if (Number.isFinite(declaredLength) && declaredLength > maxSingleBytes) continue

      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length === 0) continue
      if (buffer.length > maxSingleBytes) continue
      const totalDownloadedBytes = downloaded.reduce(
        (sum, item) => sum + Buffer.byteLength(item.data, 'base64'),
        0,
      )
      if (totalDownloadedBytes + buffer.length > maxTotalBytes) continue

      const nextItem: RemoteImageReadResult = {
        url: normalizedUrl,
        mime,
        data: buffer.toString('base64'),
        alt: candidate.alt,
        width: candidate.width,
        height: candidate.height,
        source: candidate.source,
      }

      await validateChatImages(
        [...downloaded, nextItem].map((item) => ({ data: item.data, mime: item.mime })),
        {
          ...limits,
          maxCount: Math.min(limits.maxCount, maxCount),
        },
      )
      downloaded.push(nextItem)
    } catch {
      continue
    } finally {
      clearTimeout(timer)
    }
  }

  return downloaded
}
