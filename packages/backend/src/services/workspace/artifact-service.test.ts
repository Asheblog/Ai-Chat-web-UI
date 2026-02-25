import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ArtifactService } from './artifact-service'
import { WorkspaceServiceError } from './workspace-errors'

const buildWorkspaceConfig = () => ({
  rootDir: path.join(process.cwd(), 'data', 'workspaces', 'chat'),
  artifactTtlMinutes: 60,
  idleTtlMinutes: 1440,
  cleanupIntervalMs: 300000,
  maxWorkspaceBytes: 1024 * 1024 * 1024,
  maxArtifactBytes: 100 * 1024 * 1024,
  maxArtifactsPerMessage: 20,
  runTimeoutMs: 120000,
  dockerImage: 'python:3.11-slim',
  dockerCpu: '1.0',
  dockerMemory: '1g',
  dockerPidsLimit: 256,
  artifactSigningSecret: 'unit-test-secret',
  listMaxEntries: 500,
  readMaxChars: 120000,
  gitCloneTimeoutMs: 120000,
  pythonInstallTimeoutMs: 300000,
})

describe('ArtifactService', () => {
  it('rejects tampered signature', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-svc-'))
    const artifactFile = path.resolve(tempRoot, 'artifacts', 'report.txt')
    await fs.mkdir(path.dirname(artifactFile), { recursive: true })
    await fs.writeFile(artifactFile, 'hello', 'utf8')

    const expiresAt = new Date(Date.now() + 60_000)
    const prisma = {
      workspaceArtifact: {
        findUnique: jest.fn().mockResolvedValue({
          id: 1,
          relativePath: 'artifacts/report.txt',
          fileName: 'report.txt',
          mimeType: 'text/plain',
          sizeBytes: 5,
          expiresAt,
          deletedAt: null,
          workspaceSession: { rootPath: tempRoot },
          session: { userId: 7, anonymousKey: null },
        }),
      },
    } as any

    const service = new ArtifactService({
      prisma,
      workspaceConfig: buildWorkspaceConfig() as any,
    })

    const expUnix = Math.floor(expiresAt.getTime() / 1000)

    await expect(
      service.resolveDownload({
        actor: {
          type: 'user',
          id: 7,
          username: 'u',
          role: 'USER',
          status: 'ACTIVE',
          identifier: 'user:7',
        },
        artifactId: 1,
        expUnix,
        signature: 'bad-signature',
      }),
    ).rejects.toMatchObject<Partial<WorkspaceServiceError>>({
      code: 'ARTIFACT_SIGNATURE_INVALID',
      statusCode: 403,
    })
  })

  it('returns expired when artifact passed expiry', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-svc-'))
    const artifactFile = path.resolve(tempRoot, 'artifacts', 'report.txt')
    await fs.mkdir(path.dirname(artifactFile), { recursive: true })
    await fs.writeFile(artifactFile, 'hello', 'utf8')

    const expiresAt = new Date(Date.now() - 60_000)
    const prisma = {
      workspaceArtifact: {
        findUnique: jest.fn().mockResolvedValue({
          id: 2,
          relativePath: 'artifacts/report.txt',
          fileName: 'report.txt',
          mimeType: 'text/plain',
          sizeBytes: 5,
          expiresAt,
          deletedAt: null,
          workspaceSession: { rootPath: tempRoot },
          session: { userId: 8, anonymousKey: null },
        }),
      },
    } as any

    const service = new ArtifactService({
      prisma,
      workspaceConfig: buildWorkspaceConfig() as any,
    })

    const expUnix = Math.floor(expiresAt.getTime() / 1000)
    const signature = service.buildSignature(2, expUnix)

    await expect(
      service.resolveDownload({
        actor: {
          type: 'user',
          id: 8,
          username: 'u2',
          role: 'USER',
          status: 'ACTIVE',
          identifier: 'user:8',
        },
        artifactId: 2,
        expUnix,
        signature,
      }),
    ).rejects.toMatchObject<Partial<WorkspaceServiceError>>({
      code: 'ARTIFACT_EXPIRED',
      statusCode: 410,
    })
  })
})
