/**
 * 受限前缀 MIME 识别：响应头缺失或只给出通用二进制类型时，
 * 用响应体前缀判断 HTML / 文本 / PDF / 图片 / XML feed / JSON / CSV。
 * 只读取有界前缀，不改变既有响应体大小上限与跳转规则。
 */

const MAX_SNIFF_BYTES = 2048

const GENERIC_CONTENT_TYPES = new Set([
  '',
  'application/octet-stream',
  'binary/octet-stream',
  'application/binary',
  'application/unknown',
  'unknown/unknown',
  'unknown',
])

export interface SniffContentTypeInput {
  buffer: Buffer | Uint8Array
  headerContentType?: string
  url?: string
}

export interface SniffedContentType {
  contentType: string
  declared?: string
  sniffed: boolean
}

const normalizeDeclared = (value?: string): string => {
  const normalized = (value || '').trim().toLowerCase()
  if (!normalized) return ''
  return normalized.split(';')[0]?.trim() || ''
}

const startsWith = (buffer: Buffer, bytes: number[]): boolean => {
  if (buffer.length < bytes.length) return false
  return bytes.every((byte, index) => buffer[index] === byte)
}

const decodePrefix = (buffer: Buffer): string => {
  const prefix = buffer.subarray(0, Math.min(buffer.length, MAX_SNIFF_BYTES))
  let text = prefix.toString('utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  return text
}

const looksLikeHtml = (text: string): boolean => {
  const trimmed = text.replace(/^[\s\uFEFF]+/, '')
  if (!trimmed.startsWith('<')) return false
  const head = trimmed.slice(0, 1024).toLowerCase()
  if (/^(?:<!--[\s\S]*?-->\s*)?<!doctype html/.test(head)) return true
  if (/^<html\b/.test(head) || /^<head\b/.test(head) || /^<body\b/.test(head)) return true
  return /<(?:html|body|head|meta|title|div|article|main)\b/.test(head) && head.includes('</')
}

const looksLikeFeed = (text: string): { contentType: string } | null => {
  const head = text.replace(/^[\s\uFEFF]+/, '').slice(0, 1024)
  if (/^<\?xml[^>]*\?>/i.test(head) || head.startsWith('<')) {
    if (/<(?:rss|rdf:RDF)\b/i.test(head)) return { contentType: 'application/rss+xml' }
    if (/<feed\b/i.test(head) && /xmlns=["']http:\/\/www\.w3\.org\/2005\/Atom/i.test(head)) {
      return { contentType: 'application/atom+xml' }
    }
    if (/^<\?xml/i.test(head) && /<(?:rss|feed|rdf:RDF)\b/i.test(head)) {
      return { contentType: 'application/xml' }
    }
  }
  return null
}

const looksLikeJson = (text: string): boolean => {
  const trimmed = text.replace(/^[\s\uFEFF]+/, '')
  return /^[\[{]/.test(trimmed) && /["\d\]}]/.test(trimmed.slice(1, 64))
}

const isCsvUrl = (url: string): boolean => /\.csv(?:[?#]|$)/i.test(url)
const isDocxUrl = (url: string): boolean => /\.docx(?:[?#]|$)/i.test(url)

export function sniffContentType(input: SniffContentTypeInput): SniffedContentType {
  const declared = normalizeDeclared(input.headerContentType)
  const buffer = Buffer.isBuffer(input.buffer) ? input.buffer : Buffer.from(input.buffer)
  const url = input.url || ''

  if (declared && !GENERIC_CONTENT_TYPES.has(declared)) {
    return { contentType: declared, declared, sniffed: false }
  }

  const prefix = decodePrefix(buffer)
  const result = (contentType: string): SniffedContentType => ({
    contentType,
    ...(declared ? { declared } : {}),
    sniffed: true,
  })

  if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46])) return result('application/pdf')
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return result('image/png')
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return result('image/jpeg')
  if (startsWith(buffer, [0x47, 0x49, 0x46, 0x38])) return result('image/gif')
  if (
    startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    buffer.length >= 12 &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return result('image/webp')
  }
  if (startsWith(buffer, [0x42, 0x4d])) return result('image/bmp')
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) {
    return result(
      isDocxUrl(url)
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/zip',
    )
  }

  const feed = looksLikeFeed(prefix)
  if (feed) return result(feed.contentType)

  if (looksLikeHtml(prefix)) return result('text/html')

  if (looksLikeJson(prefix)) return result('application/json')
  if (isCsvUrl(url) && /[,\t;]/.test(prefix) && /\r?\n/.test(prefix)) return result('text/csv')

  return result('text/plain')
}
