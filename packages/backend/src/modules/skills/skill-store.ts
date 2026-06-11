import type { PrismaClient } from '@prisma/client'
import { fallbackLicenseInfo, type SkillLicensePolicy } from './skill-license'

export interface CuratedSkillSource {
  key: string
  name: string
  owner: string
  repo: string
  ref: string
  description: string
  homepageUrl: string
  licensePolicy: SkillLicensePolicy
  pathFilter: (skillFilePath: string) => boolean
  fallbackSkillPaths: string[]
  tags: string[]
  maxItems?: number
}

export interface SkillStoreItem {
  key: string
  sourceKey: string
  sourceName: string
  sourceUrl: string
  repository: string
  ref: string
  subdir: string
  slug: string
  displayName: string
  description: string
  skillUrl: string
  licenseName: string | null
  licenseUrl: string | null
  licenseStatus: string
  installable: boolean
  tags: string[]
  installed?: {
    skillId: number
    versionId: number | null
    version: string | null
    status: string
  } | null
}

const titleCase = (value: string) =>
  value
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')

const dirname = (filePath: string) => filePath.replace(/\/SKILL\.md$/i, '')

const basename = (dir: string) => {
  const parts = dir.split('/').filter(Boolean)
  return parts[parts.length - 1] || dir
}

const exactDepth = (path: string, prefix: string, depth: number) => {
  if (!path.startsWith(prefix) || !path.toLowerCase().endsWith('/skill.md')) return false
  return dirname(path).split('/').filter(Boolean).length === depth
}

export const CURATED_SKILL_SOURCES: CuratedSkillSource[] = [
  {
    key: 'openai-skills',
    name: 'OpenAI Skills',
    owner: 'openai',
    repo: 'skills',
    ref: 'main',
    homepageUrl: 'https://github.com/openai/skills',
    description: 'OpenAI Codex curated skills catalog.',
    licensePolicy: {
      fallbackName: 'Per-skill license',
      fallbackUrl: 'https://github.com/openai/skills',
      allowExplicitSourceTerms: true,
    },
    pathFilter: (path) => exactDepth(path, 'skills/.curated/', 3),
    fallbackSkillPaths: [
      'skills/.curated/openai-docs/SKILL.md',
      'skills/.curated/playwright/SKILL.md',
      'skills/.curated/pdf/SKILL.md',
      'skills/.curated/security-best-practices/SKILL.md',
      'skills/.curated/sentry/SKILL.md',
      'skills/.curated/vercel-deploy/SKILL.md',
    ],
    tags: ['official', 'codex', 'curated'],
  },
  {
    key: 'anthropic-skills',
    name: 'Anthropic Skills',
    owner: 'anthropics',
    repo: 'skills',
    ref: 'main',
    homepageUrl: 'https://github.com/anthropics/skills',
    description: 'Anthropic public Agent Skills collection.',
    licensePolicy: {
      fallbackName: 'Per-skill license',
      fallbackUrl: 'https://github.com/anthropics/skills',
      allowExplicitSourceTerms: true,
    },
    pathFilter: (path) => exactDepth(path, 'skills/', 2),
    fallbackSkillPaths: [
      'skills/frontend-design/SKILL.md',
      'skills/webapp-testing/SKILL.md',
      'skills/pdf/SKILL.md',
      'skills/pptx/SKILL.md',
      'skills/xlsx/SKILL.md',
      'skills/skill-creator/SKILL.md',
    ],
    tags: ['official', 'agent-skills'],
  },
  {
    key: 'vercel-agent-skills',
    name: 'Vercel Agent Skills',
    owner: 'vercel-labs',
    repo: 'agent-skills',
    ref: 'main',
    homepageUrl: 'https://github.com/vercel-labs/agent-skills',
    description: 'Vercel engineering skills for React, Next.js, design, writing, and deployment.',
    licensePolicy: {
      fallbackName: 'MIT',
      fallbackUrl: 'https://github.com/vercel-labs/agent-skills#license',
    },
    pathFilter: (path) => exactDepth(path, 'skills/', 2),
    fallbackSkillPaths: [
      'skills/react-best-practices/SKILL.md',
      'skills/web-design-guidelines/SKILL.md',
      'skills/vercel-optimize/SKILL.md',
      'skills/deploy-to-vercel/SKILL.md',
    ],
    tags: ['official', 'vercel', 'frontend'],
  },
  {
    key: 'supabase-agent-skills',
    name: 'Supabase Agent Skills',
    owner: 'supabase',
    repo: 'agent-skills',
    ref: 'main',
    homepageUrl: 'https://github.com/supabase/agent-skills',
    description: 'Supabase skills for product development and Postgres best practices.',
    licensePolicy: {
      fallbackName: 'MIT',
      fallbackUrl: 'https://github.com/supabase/agent-skills/blob/main/LICENSE',
    },
    pathFilter: (path) => exactDepth(path, 'skills/', 2),
    fallbackSkillPaths: [
      'skills/supabase/SKILL.md',
      'skills/supabase-postgres-best-practices/SKILL.md',
    ],
    tags: ['official', 'database', 'backend'],
  },
  {
    key: 'cloudflare-skills',
    name: 'Cloudflare Skills',
    owner: 'cloudflare',
    repo: 'skills',
    ref: 'main',
    homepageUrl: 'https://github.com/cloudflare/skills',
    description: 'Cloudflare platform skills for Workers, Durable Objects, Agents SDK, and web performance.',
    licensePolicy: {
      fallbackName: 'Apache-2.0',
      fallbackUrl: 'https://github.com/cloudflare/skills/blob/main/LICENSE',
    },
    pathFilter: (path) => exactDepth(path, 'skills/', 2),
    fallbackSkillPaths: [
      'skills/cloudflare/SKILL.md',
      'skills/agents-sdk/SKILL.md',
      'skills/durable-objects/SKILL.md',
      'skills/wrangler/SKILL.md',
      'skills/web-perf/SKILL.md',
    ],
    tags: ['official', 'cloudflare', 'platform'],
  },
  {
    key: 'expo-skills',
    name: 'Expo Skills',
    owner: 'expo',
    repo: 'skills',
    ref: 'main',
    homepageUrl: 'https://github.com/expo/skills',
    description: 'Expo team skills for building, deploying, and debugging Expo apps.',
    licensePolicy: {
      fallbackName: 'MIT',
      fallbackUrl: 'https://github.com/expo/skills/blob/main/LICENSE',
    },
    pathFilter: (path) => exactDepth(path, 'plugins/expo/skills/', 4),
    fallbackSkillPaths: [
      'plugins/expo/skills/expo-deployment/SKILL.md',
      'plugins/expo/skills/expo-dev-client/SKILL.md',
      'plugins/expo/skills/native-data-fetching/SKILL.md',
      'plugins/expo/skills/upgrading-expo/SKILL.md',
    ],
    tags: ['official', 'mobile', 'react-native'],
  },
  {
    key: 'addyosmani-agent-skills',
    name: 'Addy Osmani Agent Skills',
    owner: 'addyosmani',
    repo: 'agent-skills',
    ref: 'main',
    homepageUrl: 'https://github.com/addyosmani/agent-skills',
    description: 'Production-grade engineering skills for AI coding agents.',
    licensePolicy: {
      fallbackName: 'MIT',
      fallbackUrl: 'https://github.com/addyosmani/agent-skills/blob/main/LICENSE',
    },
    pathFilter: (path) => exactDepth(path, 'skills/', 2),
    fallbackSkillPaths: [
      'skills/code-review-and-quality/SKILL.md',
      'skills/debugging-and-error-recovery/SKILL.md',
      'skills/frontend-ui-engineering/SKILL.md',
      'skills/test-driven-development/SKILL.md',
      'skills/security-and-hardening/SKILL.md',
    ],
    tags: ['community', 'engineering'],
  },
  {
    key: 'github-awesome-copilot',
    name: 'Awesome GitHub Copilot',
    owner: 'github',
    repo: 'awesome-copilot',
    ref: 'main',
    homepageUrl: 'https://github.com/github/awesome-copilot',
    description: 'GitHub community collection of Copilot skills, agents, instructions, and plugins.',
    licensePolicy: {
      fallbackName: 'MIT',
      fallbackUrl: 'https://github.com/github/awesome-copilot/blob/main/LICENSE',
    },
    pathFilter: (path) => exactDepth(path, 'skills/', 2),
    fallbackSkillPaths: [
      'skills/acquire-codebase-knowledge/SKILL.md',
      'skills/chrome-devtools/SKILL.md',
      'skills/codeql/SKILL.md',
      'skills/conventional-commit/SKILL.md',
      'skills/create-architectural-decision-record/SKILL.md',
      'skills/github-actions-efficiency/SKILL.md',
    ],
    tags: ['github', 'community'],
    maxItems: 600,
  },
]

type CachedCatalog = {
  refreshedAt: number
  items: SkillStoreItem[]
  sourceStatuses: Record<string, 'live' | 'fallback'>
}

const CACHE_TTL_MS = 20 * 60 * 1000
let memoryCache: CachedCatalog | null = null

function githubHeaders(token?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'aichat-skill-store',
  }
  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`
  }
  return headers
}

async function fetchSkillPaths(source: CuratedSkillSource, token?: string | null): Promise<string[]> {
  const url = `https://api.github.com/repos/${source.owner}/${source.repo}/git/trees/${encodeURIComponent(source.ref)}?recursive=1`
  const response = await fetch(url, { headers: githubHeaders(token) })
  if (!response.ok) {
    throw new Error(`GitHub tree fetch failed for ${source.key}: ${response.status} ${response.statusText}`)
  }
  const payload = await response.json() as { tree?: Array<{ path?: string; type?: string }> }
  const paths = (payload.tree || [])
    .filter((entry) => entry.type === 'blob' && typeof entry.path === 'string')
    .map((entry) => entry.path!)
    .filter((path) => source.pathFilter(path))
    .sort((a, b) => a.localeCompare(b))
  return source.maxItems ? paths.slice(0, source.maxItems) : paths
}

function buildItem(source: CuratedSkillSource, skillFilePath: string): SkillStoreItem {
  const subdir = dirname(skillFilePath)
  const slug = basename(subdir)
  const sourceUrl = `https://github.com/${source.owner}/${source.repo}`
  const license = fallbackLicenseInfo(source.licensePolicy)
  return {
    key: `${source.key}:${subdir}`,
    sourceKey: source.key,
    sourceName: source.name,
    sourceUrl,
    repository: `${source.owner}/${source.repo}`,
    ref: source.ref,
    subdir,
    slug,
    displayName: titleCase(slug),
    description: source.description,
    skillUrl: `${sourceUrl}/tree/${encodeURIComponent(source.ref)}/${subdir}`,
    licenseName: license.name,
    licenseUrl: license.url,
    licenseStatus: license.status,
    installable: license.installable,
    tags: source.tags,
    installed: null,
  }
}

async function loadSourceItems(
  source: CuratedSkillSource,
  token?: string | null,
): Promise<{ items: SkillStoreItem[]; status: 'live' | 'fallback' }> {
  try {
    const livePaths = await fetchSkillPaths(source, token)
    if (livePaths.length > 0) {
      return { items: livePaths.map((path) => buildItem(source, path)), status: 'live' }
    }
  } catch {
    // Fallback below keeps the store usable when GitHub is rate-limited or offline.
  }
  return {
    items: source.fallbackSkillPaths.map((path) => buildItem(source, path)),
    status: 'fallback',
  }
}

async function buildCatalog(token?: string | null): Promise<CachedCatalog> {
  const results = await Promise.all(CURATED_SKILL_SOURCES.map((source) => loadSourceItems(source, token)))
  const items = results.flatMap((result) => result.items)
  const sourceStatuses: Record<string, 'live' | 'fallback'> = {}
  CURATED_SKILL_SOURCES.forEach((source, index) => {
    sourceStatuses[source.key] = results[index].status
  })
  return {
    refreshedAt: Date.now(),
    items,
    sourceStatuses,
  }
}

async function loadCatalog(refresh = false): Promise<CachedCatalog> {
  const now = Date.now()
  if (!refresh && memoryCache && now - memoryCache.refreshedAt < CACHE_TTL_MS) {
    return memoryCache
  }
  memoryCache = await buildCatalog(process.env.GITHUB_SKILL_TOKEN || null)
  return memoryCache
}

export async function listSkillStoreCatalog(input?: {
  prisma?: PrismaClient
  userId?: number | null
  refresh?: boolean
}): Promise<{ items: SkillStoreItem[]; sources: CuratedSkillSource[]; sourceStatuses: Record<string, 'live' | 'fallback'>; refreshedAt: string }> {
  const catalog = await loadCatalog(Boolean(input?.refresh))
  let installedByKey = new Map<string, SkillStoreItem['installed']>()

  if (input?.prisma && input.userId != null) {
    const keys = catalog.items.map((item) => item.key)
    const installed = await (input.prisma as any).skill.findMany({
      where: {
        ownerUserId: input.userId,
        storeItemKey: { in: keys },
        status: 'active',
      },
      include: {
        defaultVersion: {
          select: { id: true, version: true, status: true },
        },
      },
    })
    installedByKey = new Map(
      installed.map((skill: any) => [
        skill.storeItemKey,
        {
          skillId: skill.id,
          versionId: skill.defaultVersion?.id ?? null,
          version: skill.defaultVersion?.version ?? null,
          status: skill.status,
        },
      ]),
    )
  }

  return {
    items: catalog.items.map((item) => ({
      ...item,
      installed: installedByKey.get(item.key) ?? null,
    })),
    sources: CURATED_SKILL_SOURCES,
    sourceStatuses: catalog.sourceStatuses,
    refreshedAt: new Date(catalog.refreshedAt).toISOString(),
  }
}

export async function resolveSkillStoreItem(itemKey: string): Promise<SkillStoreItem | null> {
  const normalized = itemKey.trim()
  if (!normalized) return null
  const catalog = await loadCatalog(false)
  return catalog.items.find((item) => item.key === normalized) ?? null
}

export function getCuratedSkillSource(key: string): CuratedSkillSource | null {
  return CURATED_SKILL_SOURCES.find((source) => source.key === key) ?? null
}
