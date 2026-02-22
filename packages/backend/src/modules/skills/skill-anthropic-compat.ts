import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import YAML from 'yaml'
import type { GithubSkillSource } from './skill-github-fetcher'
import type { SkillManifest } from './types'

const RESERVED_SKILL_IDS = new Set([
  'web-search',
  'python-runner',
  'url-reader',
  'document-search',
  'knowledge-base-search',
])

const DEFAULT_ENTRY_PATH = '.aichat/anthropic-skill-runner.mjs'

export interface ParsedSkillMarkdown {
  frontmatter: Record<string, unknown>
  body: string
}

export interface AnthropicCompatManifestResult {
  manifest: SkillManifest
  instruction: string
}

export class AnthropicSkillCompatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AnthropicSkillCompatError'
  }
}

async function readSkillMarkdown(extractedDir: string): Promise<{ fileName: string; content: string } | null> {
  const directCandidates = ['SKILL.md', 'skill.md']
  for (const candidate of directCandidates) {
    const fullPath = path.join(extractedDir, candidate)
    try {
      const content = await fs.readFile(fullPath, 'utf8')
      return { fileName: candidate, content }
    } catch {
      // continue
    }
  }

  const rootEntries = await fs.readdir(extractedDir, { withFileTypes: true }).catch(() => [])
  for (const entry of rootEntries) {
    if (!entry.isFile()) continue
    if (entry.name.toLowerCase() !== 'skill.md') continue
    const fullPath = path.join(extractedDir, entry.name)
    try {
      const content = await fs.readFile(fullPath, 'utf8')
      return { fileName: entry.name, content }
    } catch {
      // continue
    }
  }

  return null
}

function parseYamlFrontmatter(raw: string): ParsedSkillMarkdown {
  const text = raw.replace(/^\uFEFF/, '')
  if (!text.startsWith('---')) {
    return { frontmatter: {}, body: text }
  }

  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) {
    return { frontmatter: {}, body: text }
  }

  const frontmatterRaw = match[1]
  const body = match[2] || ''
  try {
    const parsed = YAML.parse(frontmatterRaw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new AnthropicSkillCompatError('SKILL.md frontmatter must be a YAML object')
    }
    return { frontmatter: parsed as Record<string, unknown>, body }
  } catch (error) {
    throw new AnthropicSkillCompatError(
      `Failed to parse SKILL.md frontmatter: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function toKebab(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
}

function inferIdFromSource(source: GithubSkillSource): string {
  if (source.subdir) {
    const parts = source.subdir.split('/').filter(Boolean)
    const last = parts[parts.length - 1] || ''
    const normalized = toKebab(last)
    if (normalized) return normalized
  }
  return `${toKebab(source.owner)}-${toKebab(source.repo)}`.replace(/^-+/, '').replace(/-+$/, '')
}

function normalizeSkillId(rawName: string, source: GithubSkillSource): string {
  const preferred = toKebab(rawName)
  const fallback = inferIdFromSource(source)
  const candidate = preferred || fallback || 'external-skill'
  const value = candidate.slice(0, 128)
  if (!value) {
    throw new AnthropicSkillCompatError('Unable to infer skill id from SKILL.md')
  }
  if (RESERVED_SKILL_IDS.has(value)) {
    return `ext-${value}`.slice(0, 128)
  }
  return value
}

function firstHeading(body: string): string | null {
  const lines = body.split(/\r?\n/)
  for (const line of lines) {
    const match = line.match(/^#\s+(.+?)\s*$/)
    if (match) {
      return match[1].trim()
    }
  }
  return null
}

function firstParagraph(body: string): string {
  const lines = body.replace(/\r/g, '').split('\n')
  const paragraph: string[] = []
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      if (paragraph.length > 0) break
      continue
    }
    if (line.startsWith('#')) {
      if (paragraph.length > 0) break
      continue
    }
    paragraph.push(line)
  }
  return paragraph.join(' ').trim()
}

function toToolName(skillId: string): string {
  const base = `consult_${skillId.replace(/[^a-z0-9]+/g, '_')}_skill`
  const cleaned = base
    .replace(/_+/g, '_')
    .replace(/^_+/, '')
    .replace(/_+$/, '')
  return (cleaned || 'consult_external_skill').slice(0, 64)
}

function buildCompatVersion(source: GithubSkillSource, markdown: string): string {
  const ref = toKebab(source.ref || 'main').slice(0, 24) || 'main'
  const digest = crypto.createHash('sha256').update(markdown).digest('hex').slice(0, 12)
  return `anthropic-${ref}-${digest}`.slice(0, 64)
}

function buildRunnerScript(input: {
  skillFileName: string
  skillId: string
  displayName: string
}): string {
  const { skillFileName, skillId, displayName } = input
  const constants = {
    skillFileName,
    skillId,
    displayName,
  }

  return `import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CONSTS = ${JSON.stringify(constants, null, 2)}
const MAX_INCLUDE_FILES = 10
const MAX_FILES_TOTAL_CHARS = 90000

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.resolve(__dirname, '..')

function clampNumber(value, fallback, min, max) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(min, Math.min(max, Math.floor(value)))
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10)
    if (Number.isFinite(parsed)) {
      return Math.max(min, Math.min(max, parsed))
    }
  }
  return fallback
}

function truncateText(value, maxChars) {
  if (!value) return ''
  if (value.length <= maxChars) return value
  const suffix = '\\n\\n[truncated]'
  if (maxChars <= suffix.length) {
    return value.slice(0, maxChars)
  }
  return value.slice(0, maxChars - suffix.length) + suffix
}

function normalizeRelativePath(input) {
  if (typeof input !== 'string') return null
  const normalized = input.trim().replace(/\\\\/g, '/').replace(/^\\/+/, '').replace(/\\/+/g, '/')
  if (!normalized) return null
  const safe = path.posix.normalize(normalized)
  if (!safe || safe === '.' || safe === '..' || safe.startsWith('../')) return null
  return safe
}

function isSubPath(rootDir, targetPath) {
  const root = path.resolve(rootDir)
  const target = path.resolve(targetPath)
  if (target === root) return true
  return target.startsWith(root + path.sep)
}

async function readStdin() {
  return new Promise((resolve) => {
    let raw = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      raw += chunk
    })
    process.stdin.on('end', () => {
      resolve(raw)
    })
    process.stdin.on('error', () => {
      resolve('')
    })
  })
}

function parsePayload(raw) {
  if (!raw || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function pickArgs(payload) {
  if (!payload || typeof payload !== 'object') return {}
  const args = payload.args
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {}
  return args
}

function stripFrontmatter(markdown) {
  return markdown.replace(/^---\\r?\\n[\\s\\S]*?\\r?\\n---\\r?\\n?/, '')
}

async function listReferenceFiles(rootDir) {
  const allowedExt = new Set(['.md', '.txt', '.py', '.js', '.mjs', '.cjs', '.json', '.yaml', '.yml', '.sh', '.ps1', '.bat'])
  const result = []
  const queue = ['.']
  while (queue.length > 0 && result.length < 200) {
    const relative = queue.shift()
    const current = path.resolve(rootDir, relative)
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.name === '.aichat' || entry.name === '.git' || entry.name === 'node_modules') continue
      const nextRelative = path.posix.join(relative === '.' ? '' : relative, entry.name)
      const nextFull = path.resolve(rootDir, nextRelative)
      if (!isSubPath(rootDir, nextFull)) continue
      if (entry.isDirectory()) {
        queue.push(nextRelative)
        continue
      }
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (!allowedExt.has(ext)) continue
      const normalized = nextRelative.replace(/\\\\/g, '/')
      if (normalized.toLowerCase() === CONSTS.skillFileName.toLowerCase()) continue
      result.push(normalized)
      if (result.length >= 200) break
    }
  }
  return result.sort()
}

async function safeReadIncludedFiles(rootDir, requestedFiles, maxPerFile, totalLimit) {
  const files = {}
  let consumed = 0
  for (const relPath of requestedFiles) {
    if (Object.keys(files).length >= MAX_INCLUDE_FILES) break
    if (consumed >= totalLimit) break
    const normalized = normalizeRelativePath(relPath)
    if (!normalized) continue
    const fullPath = path.resolve(rootDir, normalized)
    if (!isSubPath(rootDir, fullPath)) continue
    const stat = await fs.stat(fullPath).catch(() => null)
    if (!stat || !stat.isFile()) continue
    const raw = await fs.readFile(fullPath, 'utf8').catch(() => '')
    if (!raw) continue
    const remaining = Math.max(0, totalLimit - consumed)
    const limit = Math.max(512, Math.min(maxPerFile, remaining))
    const value = truncateText(raw, limit)
    consumed += value.length
    files[normalized] = value
  }
  return files
}

async function main() {
  const payloadRaw = process.env.AICHAT_SKILL_PAYLOAD_JSON || (await readStdin())
  const payload = parsePayload(payloadRaw)
  const args = pickArgs(payload)

  const task = typeof args.task === 'string' ? args.task.trim() : ''
  const includeFull = args.include_full_skill_markdown !== false
  const includeFiles = Array.isArray(args.include_files) ? args.include_files : []
  const maxChars = clampNumber(args.max_chars, 24000, 2000, 180000)

  const skillMdPath = path.resolve(packageRoot, CONSTS.skillFileName)
  const markdownRaw = await fs.readFile(skillMdPath, 'utf8')
  const withoutFrontmatter = stripFrontmatter(markdownRaw).trim()
  const skillMarkdown = includeFull
    ? truncateText(markdownRaw, maxChars)
    : truncateText(withoutFrontmatter, Math.max(1600, Math.floor(maxChars / 3)))

  const referenceFiles = await listReferenceFiles(packageRoot)
  const files = await safeReadIncludedFiles(
    packageRoot,
    includeFiles,
    Math.max(1000, Math.floor(maxChars / 2)),
    MAX_FILES_TOTAL_CHARS,
  )

  const result = {
    ok: true,
    skill: {
      id: CONSTS.skillId,
      name: CONSTS.displayName,
      file: CONSTS.skillFileName,
    },
    task: task || null,
    guidance: skillMarkdown,
    includeFullSkillMarkdown: includeFull,
    referenceFiles,
    includedFiles: files,
  }

  process.stdout.write(JSON.stringify(result))
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stdout.write(JSON.stringify({ ok: false, error: message }))
  process.exitCode = 1
})
`
}

async function writeRunnerFile(input: {
  extractedDir: string
  entryPath: string
  skillFileName: string
  skillId: string
  displayName: string
}): Promise<void> {
  const fullPath = path.join(input.extractedDir, input.entryPath)
  await fs.mkdir(path.dirname(fullPath), { recursive: true })
  const script = buildRunnerScript({
    skillFileName: input.skillFileName,
    skillId: input.skillId,
    displayName: input.displayName,
  })
  await fs.writeFile(fullPath, script, 'utf8')
}

export function parseSkillMarkdown(raw: string): ParsedSkillMarkdown {
  if (!raw || !raw.trim()) {
    throw new AnthropicSkillCompatError('SKILL.md is empty')
  }
  return parseYamlFrontmatter(raw)
}

export async function buildAnthropicCompatManifest(input: {
  extractedDir: string
  source: GithubSkillSource
}): Promise<AnthropicCompatManifestResult | null> {
  const markdown = await readSkillMarkdown(input.extractedDir)
  if (!markdown) {
    return null
  }

  const parsed = parseSkillMarkdown(markdown.content)
  const frontmatterName = typeof parsed.frontmatter.name === 'string' ? parsed.frontmatter.name.trim() : ''
  const skillId = normalizeSkillId(frontmatterName, input.source)

  const displayNameCandidate =
    (typeof parsed.frontmatter.title === 'string' && parsed.frontmatter.title.trim()) ||
    firstHeading(parsed.body) ||
    frontmatterName ||
    skillId
  const displayName = displayNameCandidate.slice(0, 256)

  const descriptionCandidate =
    (typeof parsed.frontmatter.description === 'string' && parsed.frontmatter.description.trim()) ||
    firstParagraph(parsed.body) ||
    `${displayName} compatibility skill`
  const description = descriptionCandidate.slice(0, 4000)

  const entry = DEFAULT_ENTRY_PATH
  await writeRunnerFile({
    extractedDir: input.extractedDir,
    entryPath: entry,
    skillFileName: markdown.fileName,
    skillId,
    displayName,
  })

  const toolName = toToolName(skillId)
  const version = buildCompatVersion(input.source, markdown.content)

  const manifest: SkillManifest = {
    id: skillId,
    name: displayName,
    version,
    entry,
    tools: [
      {
        name: toolName,
        description: `Consult ${displayName} SKILL.md guidance for this task. ${description}`.slice(0, 4000),
        input_schema: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: '当前用户任务的简要描述，用于获取最相关的技能指导',
            },
            include_full_skill_markdown: {
              type: 'boolean',
              description: '是否返回完整 SKILL.md，默认 true',
            },
            include_files: {
              type: 'array',
              description: '可选，附带返回这些相对路径文件内容，例如 ["editing.md"]',
              items: {
                type: 'string',
              },
            },
            max_chars: {
              type: 'integer',
              description: '返回内容字符上限（2000-180000）',
              minimum: 2000,
              maximum: 180000,
            },
          },
          required: ['task'],
        },
      },
    ],
    python_packages: [],
    capabilities: ['anthropic-skill-md', 'instruction-guidance'],
    runtime: {
      type: 'node',
      timeout_ms: 30000,
      max_output_chars: 120000,
    },
    permissions: [],
    platforms: ['linux', 'windows', 'darwin'],
    risk_level: 'low',
  }

  return {
    manifest,
    instruction: markdown.content,
  }
}
