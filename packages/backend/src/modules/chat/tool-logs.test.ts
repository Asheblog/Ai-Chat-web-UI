import { parseToolLogsJson } from './tool-logs'

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

