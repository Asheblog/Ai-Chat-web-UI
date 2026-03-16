import { aggregateAdjacentChunksForTest } from './enhanced-rag-service'

describe('aggregateAdjacentChunksForTest', () => {
  const baseHit = {
    documentId: 1,
    documentName: 'doc',
    score: 0.9,
    metadata: {},
  }

  it('should not merge non-adjacent chunks by default', () => {
    const hits = [
      { ...baseHit, chunkIndex: 1, content: 'A' },
      { ...baseHit, chunkIndex: 3, content: 'B' },
    ]

    const merged = aggregateAdjacentChunksForTest(hits as any)
    expect(merged).toHaveLength(2)
  })

  it('should merge adjacent chunks by default', () => {
    const hits = [
      { ...baseHit, chunkIndex: 1, content: 'A' },
      { ...baseHit, chunkIndex: 2, content: 'B' },
    ]

    const merged = aggregateAdjacentChunksForTest(hits as any)
    expect(merged).toHaveLength(1)
    expect(merged[0]?.aggregatedFrom).toEqual([1, 2])
  })
})

