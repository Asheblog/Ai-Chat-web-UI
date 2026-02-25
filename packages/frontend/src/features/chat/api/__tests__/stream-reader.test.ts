import { describe, expect, it } from 'vitest'
import { normalizeChunk } from '../stream-reader'

describe('stream-reader artifact event', () => {
  it('normalizes artifact chunk', () => {
    const chunk = normalizeChunk({
      type: 'artifact',
      artifacts: [
        {
          id: 1,
          fileName: 'report.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sizeBytes: 1024,
          expiresAt: '2026-02-25T12:30:00.000Z',
          downloadUrl: '/api/artifacts/1/download?exp=1&sig=abc',
        },
      ],
    })

    expect(chunk).toMatchObject({
      type: 'artifact',
    })
    expect(chunk?.artifacts?.[0]?.fileName).toBe('report.xlsx')
  })
})
