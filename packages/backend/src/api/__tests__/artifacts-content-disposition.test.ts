import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

jest.mock('../../middleware/auth', () => ({
  actorMiddleware: async (c: any, next: any) => {
    c.set('actor', {
      type: 'user',
      id: 1,
      role: 'USER',
      status: 'ACTIVE',
      username: 'tester',
      identifier: 'user:1',
    })
    await next()
  },
}))

import { createArtifactsApi } from '../artifacts'

describe('artifacts api content-disposition', () => {
  it('builds latin1-safe content-disposition for unicode filename', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-api-'))
    const artifactFile = path.resolve(tempRoot, 'artifacts', 'report.txt')
    await fs.mkdir(path.dirname(artifactFile), { recursive: true })
    await fs.writeFile(artifactFile, 'hello', 'utf8')

    const artifactService = {
      resolveDownload: jest.fn().mockResolvedValue({
        absolutePath: artifactFile,
        fileName: '题目_无序号.txt',
        mimeType: 'text/plain; charset=utf-8',
        sizeBytes: 5,
      }),
    }

    const app = createArtifactsApi({
      artifactService: artifactService as any,
    })

    const res = await app.request('http://localhost/3/download?exp=1772979754&sig=test')
    expect(res.status).toBe(200)

    const contentDisposition = res.headers.get('content-disposition') || ''
    expect(contentDisposition).toContain("filename*=UTF-8''")
    expect(/[\u0100-\uFFFF]/.test(contentDisposition)).toBe(false)
  })
})
