/**
 * 网页读取的公共数据类型。url-reader.ts 原样 re-export，保持既有 import 路径可用。
 */

export type UrlReadErrorCode =
  | 'INVALID_URL'
  | 'DISALLOWED_URL'
  | 'HTTP_403'
  | 'HTTP_404'
  | 'HTTP_429'
  | 'HTTP_4XX'
  | 'HTTP_5XX'
  | 'HTTP_ERROR'
  | 'JS_CHALLENGE'
  | 'ROBOTS_DENIED'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'EMPTY_CONTENT'
  | 'PARSE_EMPTY'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'FETCH_FAILED'
  | 'BODY_TOO_LARGE'
  | 'BROWSER_UNAVAILABLE'
  | 'BROWSER_BUSY'
  | 'UNKNOWN'

export type UrlReadEngineName =
  | 'native'
  | 'crawler'
  | 'browser'
  | 'deepseek_fetch'
  | 'image'
  | 'text'
  | 'feed'
  | 'pdf'
  | 'docx'
  | 'csv'
  | 'python'
  | 'wayback'
  | 'provided'

export interface UrlReadAttempt {
  engine: UrlReadEngineName
  status: 'success' | 'error' | 'skipped'
  durationMs: number
  error?: string
  errorCode?: UrlReadErrorCode
  httpStatus?: number
  contentType?: string
  finalUrl?: string
  rendered?: boolean
}

export type UrlReadContentKind = 'article' | 'structured' | 'summary' | 'none'

export interface UrlReadResult {
  title: string
  url: string
  content: string
  textContent: string
  resourceType?: 'page' | 'image' | 'text' | 'feed' | 'pdf' | 'document' | 'table'
  contentType?: string
  contentLength?: number
  excerpt?: string
  byline?: string
  siteName?: string
  lang?: string
  publishedTime?: string
  wordCount?: number
  error?: string
  errorCode?: UrlReadErrorCode
  httpStatus?: number
  fallbackUsed?: 'none' | 'crawler' | 'browser' | 'deepseek_fetch' | 'document' | 'wayback' | 'python' | 'provided'
  engine?: UrlReadEngineName
  attempts?: UrlReadAttempt[]
  finalUrl?: string
  rendered?: boolean
  confidence?: number
  contentFormat?: 'html' | 'text' | 'markdown' | 'json' | 'xml' | 'feed' | 'pdf' | 'docx' | 'csv' | 'image'
  leadImageUrl?: string
  images?: UrlReadImage[]
  contentKind?: UrlReadContentKind
  fetchedAt?: string
  archivedAt?: string
  truncated?: boolean
  retryAfterMs?: number
}

export interface UrlReadImage {
  url: string
  alt?: string
  width?: number
  height?: number
  source: 'meta' | 'content' | 'crawler' | 'direct'
}

export type RetrievalPurpose = 'current' | 'history'
export type RetrievalFreshness = 'default' | 'current'

export interface ProvidedContent {
  content: string
  kind: 'article' | 'summary' | 'snippet'
  source?: string
  fetchedAt?: string
}

export interface UrlReaderOptions {
  timeout?: number
  maxContentLength?: number
  userAgent?: string
  maxBodyBytes?: number
  enableBrowser?: boolean
  browserExecutablePath?: string
  renderWaitMs?: number
  enableDeepseekFallback?: boolean
  deepseekApiKey?: string
  signal?: AbortSignal
  /** current 默认；history 才允许使用 Wayback 存档并返回 archivedAt。 */
  purpose?: RetrievalPurpose
  /** current 绕过正文缓存；default 使用有界短缓存。 */
  freshness?: RetrievalFreshness
  cacheTtlMs?: number
  /** 调用方已取得的搜索正文；只做质量复用，不重复下载。 */
  providedContent?: ProvidedContent
}