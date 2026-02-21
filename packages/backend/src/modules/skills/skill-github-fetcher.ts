import AdmZip from 'adm-zip'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export interface GithubSkillSource {
  owner: string
  repo: string
  ref: string
  subdir?: string
}

export class GithubSkillSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GithubSkillSourceError'
  }
}

export function parseGithubSkillSource(raw: string): GithubSkillSource {
  const value = raw.trim()
  if (!value) {
    throw new GithubSkillSourceError('GitHub source is empty')
  }

  const matched = value.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)@([^:]+)(?::(.+))?$/)
  if (!matched) {
    throw new GithubSkillSourceError('GitHub source format must be owner/repo@ref[:subdir]')
  }

  const owner = matched[1]
  const repo = matched[2]
  const ref = matched[3]
  const subdirRaw = matched[4]
  const subdir = subdirRaw ? normalizeSubdir(subdirRaw) : undefined

  if (!owner || !repo || !ref) {
    throw new GithubSkillSourceError('GitHub source owner/repo/ref is invalid')
  }

  return { owner, repo, ref, subdir }
}

function normalizeSubdir(input: string): string {
  const normalized = input
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
  if (!normalized) {
    throw new GithubSkillSourceError('GitHub source subdir is invalid')
  }
  const parts = normalized.split('/')
  if (parts.some((part) => part === '..' || part === '.')) {
    throw new GithubSkillSourceError('GitHub source subdir cannot contain . or ..')
  }
  return parts.join('/')
}

function safeResolveUnder(root: string, relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/')
  const safeRelative = path.posix.normalize(normalized)
  if (safeRelative.startsWith('../') || safeRelative === '..') {
    throw new GithubSkillSourceError(`Unsafe archive path: ${relativePath}`)
  }
  const resolved = path.resolve(root, safeRelative)
  const normalizedRoot = path.resolve(root)
  if (!resolved.startsWith(normalizedRoot)) {
    throw new GithubSkillSourceError(`Unsafe archive output path: ${relativePath}`)
  }
  return resolved
}

function normalizeArchiveEntry(entryName: string): string {
  return entryName.replace(/\\/g, '/').replace(/^\/+/, '')
}

export async function downloadAndExtractGithubSkill(input: {
  source: GithubSkillSource
  token?: string
}): Promise<string> {
  const { source } = input
  const url = `https://api.github.com/repos/${source.owner}/${source.repo}/zipball/${encodeURIComponent(source.ref)}`
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'aichat-skill-installer',
  }
  if (input.token && input.token.trim()) {
    headers.Authorization = `Bearer ${input.token.trim()}`
  }

  const response = await fetch(url, { headers })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new GithubSkillSourceError(`Failed to download GitHub archive: ${response.status} ${response.statusText} ${text}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  const zip = new AdmZip(Buffer.from(arrayBuffer))
  const entries = zip.getEntries()
  if (entries.length === 0) {
    throw new GithubSkillSourceError('GitHub archive is empty')
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aichat-skill-'))
  const subdirPrefix = source.subdir ? `${source.subdir}/` : ''

  for (const entry of entries) {
    if (entry.isDirectory) continue

    const normalizedName = normalizeArchiveEntry(entry.entryName)
    const firstSlash = normalizedName.indexOf('/')
    if (firstSlash === -1) continue
    const relativeFromRepoRoot = normalizedName.slice(firstSlash + 1)
    if (!relativeFromRepoRoot) continue

    if (source.subdir) {
      if (relativeFromRepoRoot === source.subdir) {
        continue
      }
      if (!relativeFromRepoRoot.startsWith(subdirPrefix)) {
        continue
      }
    }

    const relativeOutput = source.subdir
      ? relativeFromRepoRoot.slice(subdirPrefix.length)
      : relativeFromRepoRoot

    if (!relativeOutput) continue

    const outputPath = safeResolveUnder(tempDir, relativeOutput)
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, entry.getData())
  }

  return tempDir
}
