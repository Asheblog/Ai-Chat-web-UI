import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolveWorkspacePath } from './workspace-path'
import { WorkspaceServiceError } from './workspace-errors'

describe('workspace-path', () => {
  it('rejects path traversal outside workspace root', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-path-test-'))
    await expect(
      resolveWorkspacePath(root, '../outside.txt', { requireExists: false }),
    ).rejects.toMatchObject<Partial<WorkspaceServiceError>>({
      code: 'WORKSPACE_PATH_ESCAPE',
      statusCode: 403,
    })
  })

  it('rejects absolute path input', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-path-test-'))
    await expect(
      resolveWorkspacePath(root, path.resolve(root, 'data.txt'), { requireExists: false }),
    ).rejects.toMatchObject<Partial<WorkspaceServiceError>>({
      code: 'WORKSPACE_INVALID_PATH',
      statusCode: 400,
    })
  })

  it('rejects symlink escape path', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-path-test-'))
    const root = path.resolve(base, 'workspace')
    const outside = path.resolve(base, 'outside.txt')
    const linkPath = path.resolve(root, 'link.txt')

    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(outside, 'outside', 'utf8')

    try {
      await fs.symlink(outside, linkPath)
    } catch {
      // Windows 无权限时跳过
      return
    }

    await expect(
      resolveWorkspacePath(root, 'link.txt', { requireExists: true }),
    ).rejects.toMatchObject<Partial<WorkspaceServiceError>>({
      code: 'WORKSPACE_PATH_ESCAPE',
      statusCode: 403,
    })
  })
})
