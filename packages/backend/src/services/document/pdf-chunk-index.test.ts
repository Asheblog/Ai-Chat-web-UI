import { resolvePdfChunkResumeIndex } from './pdf-chunk-index'

describe('resolvePdfChunkResumeIndex', () => {
  it('should skip parsed chunks before startIndex', () => {
    const result = resolvePdfChunkResumeIndex(1, 2)
    expect(result.skip).toBe(true)
    expect(result.index).toBe(1)
  })

  it('should persist parsed chunk at startIndex', () => {
    const result = resolvePdfChunkResumeIndex(2, 2)
    expect(result.skip).toBe(false)
    expect(result.index).toBe(2)
  })
})

