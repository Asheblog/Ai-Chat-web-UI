import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CHAT_IMAGE_PUBLIC_PATH } from '../../config/storage'
import { BattleImageService } from './battle-image-service'

const ONE_BY_ONE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2l8AAAAASUVORK5CYII='

describe('BattleImageService', () => {
  let storageRoot: string
  let service: BattleImageService

  beforeEach(async () => {
    storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'battle-image-service-'))
    service = new BattleImageService({ storageRoot })
  })

  afterEach(async () => {
    await fs.rm(storageRoot, { recursive: true, force: true })
  })

  it('persists images and loads them back as upload payloads', async () => {
    const relativePaths = await service.persistImages([
      { data: ONE_BY_ONE_PNG_BASE64, mime: 'image/png' },
    ])

    expect(relativePaths).toHaveLength(1)
    expect(relativePaths[0]?.startsWith('battle/')).toBe(true)

    const loaded = await service.loadImages(relativePaths)
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.mime).toBe('image/png')
    expect(loaded[0]?.data.length).toBeGreaterThan(0)
  })

  it('resolves keepImages from URL/path and deduplicates', async () => {
    const existing = await service.persistImages([
      { data: ONE_BY_ONE_PNG_BASE64, mime: 'image/png' },
      { data: ONE_BY_ONE_PNG_BASE64, mime: 'image/png' },
    ])
    expect(existing).toHaveLength(2)

    const first = existing[0]!
    const firstUrl = `https://example.com${CHAT_IMAGE_PUBLIC_PATH}/${first}`

    const kept = service.resolveKeptRelativePaths(
      [firstUrl, first, firstUrl, 'https://example.com/not-image.png', '../escape.png'],
      existing,
    )

    expect(kept).toEqual([first])
  })

  it('deletes only battle image files', async () => {
    const [relative] = await service.persistImages([{ data: ONE_BY_ONE_PNG_BASE64, mime: 'image/png' }])
    expect(relative).toBeTruthy()
    const absolute = path.join(storageRoot, relative!)
    await fs.access(absolute)

    await service.deleteImages([relative!, '../escape.png'])

    await expect(fs.access(absolute)).rejects.toThrow()
  })
})

