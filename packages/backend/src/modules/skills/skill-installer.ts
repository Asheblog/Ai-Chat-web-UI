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
import type { SkillManifest } from './types'

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
}

function resolveSkillStorageRoot(): string {
  const configured = process.env.SKILL_STORAGE_ROOT
  if (configured && configured.trim()) {
    return path.resolve(configured.trim())
  }
  return path.resolve(process.cwd(), 'data', 'skills')
}

async function findManifestFile(extractedDir: string): Promise<{ path: string; content: string }> {
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
  throw new SkillInstallerError('Skill package missing manifest.yaml/yml/json')
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

function resolveVersionStatusByRisk(manifest: SkillManifest): string {
  return manifest.risk_level === 'high' || manifest.risk_level === 'critical'
    ? 'pending_approval'
    : 'pending_validation'
}

async function persistInstalledPackage(params: {
  extractedDir: string
  slug: string
  versionId: number
}): Promise<string> {
  const storageRoot = resolveSkillStorageRoot()
  const destinationDir = path.join(storageRoot, 'packages', params.slug, String(params.versionId))
  await fs.mkdir(destinationDir, { recursive: true })
  await fs.cp(params.extractedDir, destinationDir, { recursive: true, force: true })
  return destinationDir
}

function toSourceUrl(source: GithubSkillSource): string {
  return `https://github.com/${source.owner}/${source.repo}`
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
      const manifest = parseSkillManifestText(manifestFile.content, manifestFile.path)
      const instruction = await readSkillInstruction(extractedDir)
      const packageHash = await computeDirectorySha256(extractedDir)

      const status = resolveVersionStatusByRisk(manifest)
      const skill = await (this.prisma as any).skill.upsert({
        where: { slug: manifest.id },
        update: {
          displayName: manifest.name,
          description: instruction ? instruction.slice(0, 4000) : undefined,
          sourceType: 'github',
          sourceUrl: toSourceUrl(source),
        },
        create: {
          slug: manifest.id,
          displayName: manifest.name,
          description: instruction ? instruction.slice(0, 4000) : null,
          sourceType: 'github',
          sourceUrl: toSourceUrl(source),
          status: 'active',
          createdByUserId: input.actorUserId ?? null,
        },
      })

      const existing = await (this.prisma as any).skillVersion.findFirst({
        where: {
          skillId: skill.id,
          version: manifest.version,
        },
        select: { id: true },
      })
      if (existing) {
        throw new SkillInstallerError(`Skill version already exists: ${manifest.id}@${manifest.version}`)
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
          sourceRef: source.ref,
          sourceSubdir: source.subdir ?? null,
          createdByUserId: input.actorUserId ?? null,
        },
      })

      const packagePath = await persistInstalledPackage({
        extractedDir,
        slug: skill.slug,
        versionId: version.id,
      })

      const updatedVersion = await (this.prisma as any).skillVersion.update({
        where: { id: version.id },
        data: {
          packagePath,
        },
      })

      return {
        skill: {
          id: skill.id,
          slug: skill.slug,
          displayName: skill.displayName,
          status: skill.status,
        },
        version: {
          id: updatedVersion.id,
          version: updatedVersion.version,
          status: updatedVersion.status,
          packagePath: updatedVersion.packagePath,
        },
      }
    } finally {
      await fs.rm(extractedDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

export const skillInstaller = new SkillInstaller()
