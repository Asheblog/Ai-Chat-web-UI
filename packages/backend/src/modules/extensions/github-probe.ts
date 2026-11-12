import type { ExtensionSourceRef, ProbeFileSet } from './types'

const GITHUB_API = 'https://api.github.com'
const REQUEST_TIMEOUT_MS = Number(process.env.EXTENSION_PROBE_TIMEOUT_MS || 8000)
const MAX_FILES = 10
const MAX_FILE_BYTES = 256 * 1024
const MAX_TOTAL_BYTES = 1024 * 1024
const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_MAX_ENTRIES = 200

export class ExtensionProbeError extends Error {
  statusCode: number
  constructor(message: string, statusCode = 502) {
    super(message)
    this.name = 'ExtensionProbeError'
    this.statusCode = statusCode
  }
}

interface CacheEntry {
  value: string | null
  expiresAt: number
}

const fileCache = new Map<string, CacheEntry>()

function readToken(): string | undefined {
  const token = (process.env.GITHUB_SKILL_TOKEN || process.env.GITHUB_TOKEN || '').trim()
  return token || undefined
}

function headersFor(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.raw',
    'User-Agent': 'aichat-extension-probe',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const token = readToken()
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function githubFetch(url: string, accept?: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const headers = headersFor()
    if (accept) headers.Accept = accept
    const response = await fetch(url, { headers, signal: controller.signal })
    return response
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      throw new ExtensionProbeError('GitHub 请求超时，请稍后重试', 504)
    }
    throw new ExtensionProbeError(`GitHub 请求失败：${(error as Error)?.message ?? 'unknown'}`)
  } finally {
    clearTimeout(timer)
  }
}

function cacheKey(owner: string, repo: string, ref: string, path: string): string {
  return `${owner}/${repo}@${ref}:${path}`.toLowerCase()
}

function readCache(key: string): { hit: boolean; value: string | null } {
  const entry = fileCache.get(key)
  if (!entry) return { hit: false, value: null }
  if (entry.expiresAt < Date.now()) {
    fileCache.delete(key)
    return { hit: false, value: null }
  }
  return { hit: true, value: entry.value }
}

function writeCache(key: string, value: string | null): void {
  if (fileCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = fileCache.keys().next().value
    if (oldest) fileCache.delete(oldest)
  }
  fileCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
}

/** 清空探测缓存（测试与手动刷新用）。 */
export function clearExtensionProbeCache(): void {
  fileCache.clear()
}

/** 取仓库默认分支；私有仓库在无 token 时会以 404 呈现。 */
export async function resolveDefaultBranch(owner: string, repo: string): Promise<string> {
  const response = await githubFetch(
    `${GITHUB_API}/repos/${owner}/${repo}`,
    'application/vnd.github+json',
  )
  if (response.status === 404) {
    throw new ExtensionProbeError(
      readToken()
        ? `仓库 ${owner}/${repo} 不存在或 token 无权访问`
        : `仓库 ${owner}/${repo} 不存在，或为私有仓库（需要配置 GITHUB_TOKEN）`,
      404,
    )
  }
  if (response.status === 403) {
    throw new ExtensionProbeError('GitHub 接口限流或无权访问，请配置 GITHUB_TOKEN 后重试', 403)
  }
  if (!response.ok) {
    throw new ExtensionProbeError(`读取仓库信息失败：HTTP ${response.status}`)
  }
  const payload = (await response.json()) as { default_branch?: string }
  const branch = (payload.default_branch || '').trim()
  if (!branch) throw new ExtensionProbeError('仓库未返回默认分支')
  return branch
}

/** 读取单文件内容；不存在返回 null。 */
export async function fetchRepoFile(
  owner: string,
  repo: string,
  ref: string,
  path: string,
): Promise<string | null> {
  const key = cacheKey(owner, repo, ref, path)
  const cached = readCache(key)
  if (cached.hit) return cached.value

  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  const response = await githubFetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
  )

  if (response.status === 404) {
    writeCache(key, null)
    return null
  }
  if (response.status === 403) {
    throw new ExtensionProbeError('GitHub 接口限流或无权访问，请配置 GITHUB_TOKEN 后重试', 403)
  }
  if (!response.ok) {
    throw new ExtensionProbeError(`读取 ${path} 失败：HTTP ${response.status}`)
  }

  const declaredLength = Number(response.headers.get('content-length') || '0')
  if (declaredLength > MAX_FILE_BYTES) {
    writeCache(key, null)
    return null
  }

  const text = await response.text()
  if (text.length > MAX_FILE_BYTES) {
    writeCache(key, null)
    return null
  }
  writeCache(key, text)
  return text
}

/**
 * 探测仓库白名单文件。只拉取清单中的文件，永不整包下载。
 * 缺省 ref 时先取默认分支。
 */
export async function probeRepository(
  source: ExtensionSourceRef,
  fileNames: string[],
): Promise<ProbeFileSet> {
  const ref = source.ref || (await resolveDefaultBranch(source.owner, source.repo))
  const prefix = source.subdir ? `${source.subdir}/` : ''
  const targets = fileNames.slice(0, MAX_FILES)

  const files: Record<string, string> = {}
  const skipped: string[] = []
  const failures: string[] = []
  let totalBytes = 0

  for (const name of targets) {
    const path = `${prefix}${name}`
    let content: string | null = null
    try {
      content = await fetchRepoFile(source.owner, source.repo, ref, path)
    } catch (error) {
      // 单个文件失败不阻断整体判定，但要留下原因：全都没读到时必须把真实原因抛给调用方
      skipped.push(path)
      failures.push((error as Error)?.message ?? 'unknown')
      continue
    }
    if (!content) {
      continue
    }
    if (totalBytes + content.length > MAX_TOTAL_BYTES) {
      skipped.push(path)
      continue
    }
    totalBytes += content.length
    files[name] = content
  }

  if (Object.keys(files).length === 0 && failures.length > 0) {
    throw new ExtensionProbeError(
      `读取 ${source.owner}/${source.repo} 失败：${failures[0]}`,
    )
  }

  return { files, skipped, ref }
}
