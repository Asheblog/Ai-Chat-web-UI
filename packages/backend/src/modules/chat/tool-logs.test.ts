import { parseToolLogsJson, sanitizeToolLogEntryForPersistence, serializeToolLogsForPersistence } from './tool-logs'

describe('sanitizeToolLogEntryForPersistence', () => {
  test('truncates large content/snippet in web_search hits while preserving metadata', () => {
    const longContent = 'A'.repeat(10000)
    const longSnippet = 'B'.repeat(5000)
    const entry = {
      id: 'tool-1',
      tool: 'web_search',
      stage: 'result' as const,
      createdAt: Date.now(),
      status: 'success' as const,
      query: 'test query',
      hits: [
        {
          title: 'Result A',
          url: 'https://example.com/a',
          snippet: longSnippet,
          content: longContent,
          imageUrl: 'https://cdn.example.com/a.jpg',
          thumbnailUrl: 'https://cdn.example.com/a-thumb.jpg',
          engine: 'tavily',
          rank: 1,
          sourceEngines: ['tavily'],
        },
      ],
    }

    const result = sanitizeToolLogEntryForPersistence(entry)

    // Preserved fields
    expect(result.hits).toHaveLength(1)
    expect(result.hits![0].title).toBe('Result A')
    expect(result.hits![0].url).toBe('https://example.com/a')
    expect(result.hits![0].imageUrl).toBe('https://cdn.example.com/a.jpg')
    expect(result.hits![0].thumbnailUrl).toBe('https://cdn.example.com/a-thumb.jpg')

    // Truncated fields
    expect(result.hits![0].snippet?.length).toBeLessThanOrEqual(210)
    expect(result.hits![0].content).toBeUndefined()

    // Entry level fields preserved
    expect(result.id).toBe('tool-1')
    expect(result.tool).toBe('web_search')
    expect(result.stage).toBe('result')
    expect(result.status).toBe('success')
    expect(result.query).toBe('test query')

    // Original not mutated
    expect(entry.hits![0].content).toBe(longContent)
    expect(entry.hits![0].snippet).toBe(longSnippet)
  })

  test('caps hits array to 10 entries maximum', () => {
    const manyHits = Array.from({ length: 50 }, (_, i) => ({
      title: `Hit ${i}`,
      url: `https://example.com/${i}`,
      snippet: 'normal snippet',
    }))
    const entry = {
      id: 'tool-1',
      tool: 'web_search',
      stage: 'result' as const,
      createdAt: Date.now(),
      hits: manyHits,
    }

    const result = sanitizeToolLogEntryForPersistence(entry)

    expect(result.hits).toHaveLength(10)
    expect(result.hits![9].title).toBe('Hit 9')
    expect(result.hits![9].url).toBe('https://example.com/9')
  })
})

describe('serializeToolLogsForPersistence', () => {
  test('returns null for empty array', () => {
    expect(serializeToolLogsForPersistence([])).toBeNull()
  })

  test('enforces total size cap by compressing old events', () => {
    // Simulate 124 large web_search result events (production scenario)
    const manyEntries = Array.from({ length: 124 }, (_, i) => ({
      id: `tool-${i + 1}`,
      tool: 'web_search',
      stage: (i === 0 ? 'start' : 'result') as 'start' | 'result',
      createdAt: Date.now() + i,
      status: 'success' as const,
      query: `test query ${i + 1}`,
      hits: Array.from({ length: 10 }, (_, j) => ({
        title: `Result ${i}-${j}`,
        url: `https://example.com/${i}/${j}`,
        snippet: 'C'.repeat(500),
        content: 'D'.repeat(10000),
        imageUrl: `https://cdn.example.com/${i}/${j}.jpg`,
        thumbnailUrl: `https://cdn.example.com/${i}/${j}-thumb.jpg`,
      })),
    }))

    const serialized = serializeToolLogsForPersistence(manyEntries)
    expect(serialized).not.toBeNull()
    expect(Buffer.byteLength(serialized!, 'utf-8')).toBeLessThanOrEqual(512 * 1024)
  })

  test('truncates large details fields for python_runner and sets truncated flag', () => {
    const entry = {
      id: 'py-1',
      tool: 'python_runner',
      stage: 'result' as const,
      createdAt: Date.now(),
      status: 'success' as const,
      details: {
        code: 'print("hello")',
        input: 'A'.repeat(1000),
        stdout: 'B'.repeat(3000),
        stderr: '',
        exitCode: 0,
        durationMs: 1500,
        resultText: 'C'.repeat(8000),
        extraField: 'should-be-preserved',
      },
    }

    const result = sanitizeToolLogEntryForPersistence(entry)

    // Small fields preserved as-is
    expect(result.details).toBeDefined()
    expect(result.details!.code).toBe('print("hello")')
    expect(result.details!.exitCode).toBe(0)
    expect(result.details!.durationMs).toBe(1500)
    expect(result.details!.extraField).toBe('should-be-preserved')

    // Large fields truncated
    expect(result.details!.input!.length).toBeLessThanOrEqual(510)
    expect(result.details!.stdout!.length).toBeLessThanOrEqual(510)
    expect(result.details!.resultText!.length).toBeLessThanOrEqual(510)

    // truncated flag set
    expect(result.details!.truncated).toBe(true)

    // Original not mutated
    expect(entry.details.input).toBe('A'.repeat(1000))
  })

  test('enforces strict byte limit with single giant entry (compresses all fields)', () => {
    const giantEntry = {
      id: 'tool-1',
      tool: 'web_search',
      stage: 'result' as const,
      createdAt: Date.now(),
      query: 'x'.repeat(5000),
      summary: 'y'.repeat(3000),
      error: 'z'.repeat(2000),
      hits: Array.from({ length: 10 }, (_, j) => ({
        title: `Result ${j}`,
        url: `https://example.com/${j}`,
        snippet: 'm'.repeat(500),
        content: 'n'.repeat(10000),
        imageUrl: `https://cdn.example.com/${j}.jpg`,
        thumbnailUrl: `https://cdn.example.com/${j}-thumb.jpg`,
      })),
    }

    const serialized = serializeToolLogsForPersistence([giantEntry], 4096)
    expect(serialized).not.toBeNull()
    expect(Buffer.byteLength(serialized!, 'utf-8')).toBeLessThanOrEqual(4096)
  })

  test('enforces strict byte limit compressing head/tail entries when needed', () => {
    const manyLarge = Array.from({ length: 10 }, (_, i) => ({
      id: `tool-${i + 1}`,
      tool: 'web_search',
      stage: (i === 0 ? 'start' : 'result') as 'start' | 'result',
      createdAt: Date.now() + i,
      query: 'q'.repeat(2000) + i,
      details: { bigField: 'd'.repeat(5000) },
    }))

    const serialized = serializeToolLogsForPersistence(manyLarge, 4096)
    expect(serialized).not.toBeNull()
    expect(Buffer.byteLength(serialized!, 'utf-8')).toBeLessThanOrEqual(4096)
  })
})

describe('parseToolLogsJson', () => {
  test('preserves image metadata in web search hits', () => {
    const logs = parseToolLogsJson(
      JSON.stringify([
        {
          id: 'tool-1',
          tool: 'web_search',
          stage: 'result',
          createdAt: Date.now(),
          hits: [
            {
              title: 'Result A',
              url: 'https://example.com/a',
              imageUrl: 'https://cdn.example.com/a.jpg',
              thumbnailUrl: 'https://cdn.example.com/a-thumb.jpg',
              snippet: 'desc',
            },
          ],
        },
      ]),
    )

    expect(logs).toHaveLength(1)
    expect(logs[0].hits).toEqual([
      expect.objectContaining({
        title: 'Result A',
        url: 'https://example.com/a',
        imageUrl: 'https://cdn.example.com/a.jpg',
        thumbnailUrl: 'https://cdn.example.com/a-thumb.jpg',
      }),
    ])
  })
})

