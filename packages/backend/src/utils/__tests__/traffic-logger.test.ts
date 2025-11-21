import { getTrafficLogger, setTrafficLogger, logTraffic } from '../traffic-logger'

describe('traffic-logger util', () => {
  const original = getTrafficLogger()

  afterEach(() => {
    setTrafficLogger(original)
  })

  it('delegates to injected traffic logger', async () => {
    const logFn = jest.fn()
    const fakeLogger = { log: logFn } as any

    setTrafficLogger(fakeLogger)
    await logTraffic({ category: 'client-request', route: '/x', direction: 'inbound' })

    expect(logFn).toHaveBeenCalledWith({ category: 'client-request', route: '/x', direction: 'inbound' })
  })
})
