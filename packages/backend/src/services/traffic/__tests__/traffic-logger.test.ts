import { TrafficLogger } from '../traffic-logger'

describe('TrafficLogger', () => {
  test('writes traffic log to resolved path', async () => {
    const writes: Array<{ path: string; data: string }> = []
    const mkdirCalls: string[] = []
    const logger = new TrafficLogger({
      append: async (path, data) => {
        writes.push({ path: String(path), data: String(data) })
      },
      mkdir: async (path) => {
        mkdirCalls.push(String(path))
      },
      resolvePath: () => '/tmp/logs/traffic.log',
      now: () => new Date('2024-01-01T00:00:00Z'),
      logger: { error: jest.fn() },
    })

    await logger.log({
      category: 'client-request',
      route: '/api/chat/stream',
      direction: 'inbound',
      context: { sessionId: 1 },
      payload: { foo: 'bar' },
    })

    expect(mkdirCalls[0]).toBe('/tmp/logs')
    expect(writes[0].path).toBe('/tmp/logs/traffic.log')
    expect(writes[0].data).toContain('"route":"/api/chat/stream"')
    expect(writes[0].data).toContain('"timestamp":"2024-01-01T00:00:00.000Z"')
  })

  test('swallows errors and logs', async () => {
    const errorSpy = jest.fn()
    const logger = new TrafficLogger({
      append: async () => {
        throw new Error('disk full')
      },
      mkdir: async () => {},
      resolvePath: () => '/tmp/logs/traffic.log',
      now: () => new Date(),
      logger: { error: errorSpy },
    })

    await logger.log({
      category: 'client-request',
      route: '/api/foo',
      direction: 'inbound',
    })

    expect(errorSpy).toHaveBeenCalled()
  })
})
