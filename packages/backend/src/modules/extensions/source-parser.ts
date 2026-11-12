import type { ExtensionSourceRef } from './types'

export class ExtensionSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExtensionSourceError'
  }
}

const OWNER_REPO = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/

function normalizeSubdir(input: string): string {
  const normalized = input
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
  if (!normalized) return ''
  const parts = normalized.split('/')
  if (parts.some((part) => part === '..' || part === '.')) {
    throw new ExtensionSourceError('子目录不能包含 . 或 ..')
  }
  return parts.join('/')
}

function stripDecorations(value: string): string {
  let result = value.trim()
  // 去掉行内代码/引号/包裹字符
  result = result.replace(/^[\s<\[("'`]+/, '').replace(/[\s>\])"'`,.;]+$/, '')
  return result
}

/**
 * 支持：
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo/tree/<ref>/<subdir>
 * - https://github.com/owner/repo/blob/<ref>/<path>/SKILL.md
 * - https://raw.githubusercontent.com/owner/repo/<ref>/<path>
 * - git@github.com:owner/repo.git
 * - owner/repo  |  owner/repo@ref  |  owner/repo@ref:subdir
 */
export function parseExtensionSource(raw: string): ExtensionSourceRef {
  const original = (raw ?? '').trim()
  if (!original) throw new ExtensionSourceError('安装源为空')

  const value = stripDecorations(original)

  const scp = value.match(/^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/)
  if (scp) return { owner: scp[1]!, repo: scp[2]!, raw: original }

  const plain = value.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:@([^:]+))?(?::(.+))?$/)
  if (plain && !/^https?:/i.test(value)) {
    const owner = plain[1]!
    const repo = plain[2]!
    const ref = plain[3]?.trim() || undefined
    const subdirRaw = plain[4]?.trim()
    return {
      owner,
      repo,
      ref,
      subdir: subdirRaw ? normalizeSubdir(subdirRaw) : undefined,
      raw: original,
    }
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ExtensionSourceError(
      '无法识别的安装源，请提供 github.com 仓库链接或 owner/repo@ref:subdir',
    )
  }

  const host = url.hostname.toLowerCase()
  const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)

  if (host === 'raw.githubusercontent.com') {
    const [owner, repo, ref, ...rest] = segments
    if (!owner || !repo || !ref || rest.length === 0) {
      throw new ExtensionSourceError('raw.githubusercontent.com 链接缺少 owner/repo/ref/路径')
    }
    const filePath = rest.join('/')
    return {
      owner,
      repo,
      ref,
      subdir: normalizeSubdir(filePath.replace(/\/[^/]+$/, '')),
      raw: original,
    }
  }

  if (host !== 'github.com' && host !== 'www.github.com') {
    throw new ExtensionSourceError('当前只支持 GitHub 仓库作为安装源')
  }

  if (segments.length < 2) {
    throw new ExtensionSourceError('GitHub 链接缺少 owner/repo')
  }

  const owner = segments[0]!
  const repo = segments[1]!.replace(/\.git$/i, '')
  const mode = segments[2]
  const ref = segments[3]
  const rest = segments.slice(4)

  if ((mode === 'tree' || mode === 'blob') && ref) {
    const tail = rest.length > 0 ? rest.join('/') : ''
    const looksLikeFile = mode === 'blob' || /\.[A-Za-z0-9]+$/.test(tail)
    const subdir = looksLikeFile && tail ? tail.replace(/\/[^/]+$/, '') : tail
    return {
      owner,
      repo,
      ref,
      subdir: subdir ? normalizeSubdir(subdir) : undefined,
      raw: original,
    }
  }

  if (!OWNER_REPO.test(`${owner}/${repo}`)) {
    throw new ExtensionSourceError('GitHub owner/repo 含非法字符')
  }

  return { owner, repo, raw: original }
}

/** 仓库根的规范化 sourceUrl，用于安装记录与去重。 */
export function toSourceUrl(ref: ExtensionSourceRef): string {
  const base = `https://github.com/${ref.owner}/${ref.repo}`
  if (ref.subdir) return `${base}/tree/${ref.ref ?? 'HEAD'}/${ref.subdir}`
  if (ref.ref) return `${base}/tree/${ref.ref}`
  return base
}

/** MCP 安装模板的 namespaceKey：owner/repo#subdir，归一到安全字符集。 */
export function toNamespaceKey(ref: ExtensionSourceRef): string {
  const base = `${ref.owner}/${ref.repo}`.toLowerCase()
  const withSubdir = ref.subdir ? `${base}#${ref.subdir.toLowerCase()}` : base
  const safe = withSubdir.replace(/[^a-z0-9/.#_-]+/g, '-').replace(/-+/g, '-').slice(0, 200)
  return safe.length >= 3 ? safe : `gh-${safe}`
}
