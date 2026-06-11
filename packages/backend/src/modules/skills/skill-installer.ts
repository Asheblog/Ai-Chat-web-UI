import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { prisma as defaultPrisma } from '../../db'
import { parseSkillManifestText } from './skill-manifest'
import {
  downloadAndExtractGithubSkill,
  parseGithubSkillSource,
  type GithubSkillSource,
} from './skill-github-fetcher'
import { buildAnthropicCompatManifest } from './skill-anthropic-compat'
import type { SkillManifest } from './types'
import { readSkillLicenseInfo, type SkillLicenseInfo, type SkillLicensePolicy } from './skill-license'

export interface SkillInstallerDeps {
  prisma?: typeof defaultPrisma
}

export class SkillInstallerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkillInstallerError'
  }
}

export interface InstallFromGithubInput {
  source: string
  actorUserId?: number | null
  token?: string
  storeItemKey?: string | null
  sourceKey?: string | null
  licensePolicy?: SkillLicensePolicy | null
  trustedSource?: boolean
}

export interface InstallSkillResult {
  skill: {
    id: number
    slug: string
    displayName: string
    status: string
  }
  version: {
    id: number
    version: string
    status: string
    packagePath: string | null
  }
  license: SkillLicenseInfo
}

function resolveSkillStorageRoot(): string {
  const configured = process.env.SKILL_STORAGE_ROOT
  if (configured && configured.trim()) {
    return path.resolve(configured.trim())
  }
  const appDataDir = process.env.APP_DATA_DIR || process.env.DATA_DIR
  if (appDataDir && appDataDir.trim()) {
    return path.resolve(appDataDir.trim(), 'skills')
  }
  return path.resolve(process.cwd(), 'data', 'skills')
}

async function findManifestFile(extractedDir: string): Promise<{ path: string; content: string } | null> {
  const candidates = ['manifest.yaml', 'manifest.yml', 'manifest.json']
  for (const candidate of candidates) {
    const fullPath = path.join(extractedDir, candidate)
    try {
      const content = await fs.readFile(fullPath, 'utf8')
      return { path: fullPath, content }
    } catch {
      // continue
    }
  }
  return null
}

async function readSkillInstruction(extractedDir: string): Promise<string | null> {
  const candidates = ['SKILL.md', 'skill.md']
  for (const candidate of candidates) {
    const fullPath = path.join(extractedDir, candidate)
    try {
      const content = await fs.readFile(fullPath, 'utf8')
      return content
    } catch {
      // continue
    }
  }
  return null
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const result: string[] = []
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()!
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      result.push(fullPath)
    }
  }
  return result.sort()
}

async function computeDirectorySha256(root: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  const files = await listFilesRecursive(root)
  for (const file of files) {
    const relative = path.relative(root, file).replace(/\\/g, '/')
    hash.update(relative)
    const data = await fs.readFile(file)
    hash.update(data)
  }
  return hash.digest('hex')
}

function resolveVersionStatusByRisk(manifest: SkillManifest, autoActivate: boolean): string {
  if (autoActivate) return 'active'
  return manifest.risk_level === 'high' || manifest.risk_level === 'critical'
    ? 'pending_approval'
    : 'pending_validation'
}

function buildCompatVersionFromPackageHash(ref: string, packageHash: string): string {
  const refPart = ref
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 24) || 'main'
  return `anthropic-${refPart}-${packageHash.slice(0, 12)}`.slice(0, 64)
}

async function persistInstalledPackage(params: {
  extractedDir: string
  packageHash: string
}): Promise<string> {
  const storageRoot = resolveSkillStorageRoot()
  const destinationDir = path.join(storageRoot, 'packages', params.packageHash.slice(0, 2), params.packageHash)
  try {
    const stat = await fs.stat(destinationDir)
    if (stat.isDirectory()) return destinationDir
  } catch {
    // copy below
  }
  await fs.mkdir(destinationDir, { recursive: true })
  await fs.cp(params.extractedDir, destinationDir, { recursive: true, force: true })
  return destinationDir
}

function toSourceUrl(source: GithubSkillSource): string {
  const base = `https://github.com/${source.owner}/${source.repo}`
  if (!source.subdir) return base
  return `${base}/tree/${encodeURIComponent(source.ref)}/${source.subdir}`
}

function buildNamespaceKey(input: {
  source: GithubSkillSource
  manifestId: string
  actorUserId?: number | null
  storeItemKey?: string | null
}): string {
  if (!input.actorUserId) {
    return `system:${input.manifestId}`
  }
  const sourceIdentity = input.storeItemKey?.trim()
    || `github:${input.source.owner}/${input.source.repo}:${input.source.ref}:${input.source.subdir || '.'}`
  return `user:${input.actorUserId}:${sourceIdentity}`
}

function buildContentVersion(rawVersion: string, packageHash: string): string {
  const base = (rawVersion || '1.0.0').trim().replace(/\s+/g, '-').slice(0, 44) || '1.0.0'
  const suffix = `sha.${packageHash.slice(0, 12)}`
  if (base.includes(packageHash.slice(0, 12))) return base.slice(0, 64)
  return `${base}+${suffix}`.slice(0, 64)
}

export class SkillInstaller {
  private prisma: typeof defaultPrisma

  constructor(deps: SkillInstallerDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
  }

  async installFromGithub(input: InstallFromGithubInput): Promise<InstallSkillResult> {
    const source = parseGithubSkillSource(input.source)
    const extractedDir = await downloadAndExtractGithubSkill({
      source,
      token: input.token,
    })

    try {
      const manifestFile = await findManifestFile(extractedDir)
      const instructionFromFile = await readSkillInstruction(extractedDir)
      let manifest: SkillManifest
      let instruction = instructionFromFile
      let usedAnthropicCompat = false

      if (manifestFile) {
        manifest = parseSkillManifestText(manifestFile.content, manifestFile.path)
      } else {
        const compat = await buildAnthropicCompatManifest({ extractedDir, source })
        if (!compat) {
          throw new SkillInstallerError('Skill package missing manifest.yaml/yml/json and SKILL.md')
        }
        manifest = compat.manifest
        instruction = compat.instruction
        usedAnthropicCompat = true
      }

      const packageHash = await computeDirectorySha256(extractedDir)
      if (usedAnthropicCompat) {
        manifest = {
          ...manifest,
          version: buildCompatVersionFromPackageHash(source.ref, packageHash),
        }
      } else {
        manifest = {
          ...manifest,
          version: buildContentVersion(manifest.version, packageHash),
        }
      }

      const license = await readSkillLicenseInfo(extractedDir, input.licensePolicy ?? undefined)
      if (!license.installable) {
        throw new SkillInstallerError(`Skill license blocked: ${license.reason}`)
      }

      const namespaceKey = buildNamespaceKey({
        source,
        manifestId: manifest.id,
        actorUserId: input.actorUserId ?? null,
        storeItemKey: input.storeItemKey ?? null,
      })
      const sourceUrl = toSourceUrl(source)
      const autoActivate = Boolean(input.trustedSource && license.installable)
      const status = resolveVersionStatusByRisk(manifest, autoActivate)
      const now = new Date()
      const packagePath = await persistInstalledPackage({
        extractedDir,
        packageHash,
      })

      let skill = await (this.prisma as any).skill.findUnique({
        where: { namespaceKey },
      })
      if (skill) {
        skill = await (this.prisma as any).skill.update({
          where: { id: skill.id },
          data: {
            slug: manifest.id,
            displayName: manifest.name,
            description: instruction ? instruction.slice(0, 4000) : undefined,
            sourceType: 'github',
            sourceUrl,
            sourceKey: input.sourceKey ?? null,
            storeItemKey: input.storeItemKey ?? null,
            visibility: input.actorUserId ? 'user_private' : 'system',
            licenseName: license.name,
            licenseUrl: license.url,
            licenseStatus: license.status,
            status: 'active',
          },
        })
      } else {
        skill = await (this.prisma as any).skill.create({
          data: {
            namespaceKey,
            slug: manifest.id,
            displayName: manifest.name,
            description: instruction ? instruction.slice(0, 4000) : null,
            sourceType: 'github',
            sourceUrl,
            sourceKey: input.sourceKey ?? null,
            storeItemKey: input.storeItemKey ?? null,
            visibility: input.actorUserId ? 'user_private' : 'system',
            licenseName: license.name,
            licenseUrl: license.url,
            licenseStatus: license.status,
            status: 'active',
            ownerUserId: input.actorUserId ?? null,
          },
        })
      }

      const existing = await (this.prisma as any).skillVersion.findFirst({
        where: {
          skillId: skill.id,
          version: manifest.version,
        },
        select: { id: true, version: true, status: true, packagePath: true },
      })
      if (existing) {
        const version =
          autoActivate && existing.status !== 'active'
            ? await (this.prisma as any).skillVersion.update({
                where: { id: existing.id },
                data: {
                  status: 'active',
                  approvedAt: now,
                  activatedAt: now,
                },
                select: { id: true, version: true, status: true, packagePath: true },
              })
            : existing
        if (autoActivate && skill.defaultVersionId !== version.id) {
          skill = await (this.prisma as any).skill.update({
            where: { id: skill.id },
            data: {
              defaultVersionId: version.id,
              status: 'active',
            },
          })
        }
        return {
          skill: {
            id: skill.id,
            slug: skill.slug,
            displayName: skill.displayName,
            status: skill.status,
          },
          version: {
            id: version.id,
            version: version.version,
            status: version.status,
            packagePath: version.packagePath,
          },
          license,
        }
      }

      const version = await (this.prisma as any).skillVersion.create({
        data: {
          skillId: skill.id,
          version: manifest.version,
          status,
          riskLevel: manifest.risk_level,
          entry: manifest.entry,
          instruction: instruction ?? null,
          manifestJson: JSON.stringify(manifest),
          packageHash,
          packagePath,
          sourceRef: source.ref,
          sourceSubdir: source.subdir ?? null,
          approvedAt: autoActivate ? now : null,
          activatedAt: autoActivate ? now : null,
          createdByUserId: input.actorUserId ?? null,
        },
      })

      if (autoActivate) {
        skill = await (this.prisma as any).skill.update({
          where: { id: skill.id },
          data: {
            defaultVersionId: version.id,
            status: 'active',
          },
        })
      }

      return {
        skill: {
          id: skill.id,
          slug: skill.slug,
          displayName: skill.displayName,
          status: skill.status,
        },
        version: {
          id: version.id,
          version: version.version,
          status: version.status,
          packagePath: version.packagePath,
        },
        license,
      }
    } finally {
      await fs.rm(extractedDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

export const skillInstaller = new SkillInstaller()
