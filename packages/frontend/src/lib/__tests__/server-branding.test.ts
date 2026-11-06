import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const REVALIDATE_KEY = 'BRANDING_REVALIDATE_SECONDS'

const fetchSpy = vi.fn()

const loadModule = async () => {
  vi.resetModules()
  return await import('@/lib/server-branding')
}

describe('server-branding 缓存策略', () => {
  beforeEach(() => {
    fetchSpy.mockReset()
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ data: { brand_text: '新站点名' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env[REVALIDATE_KEY]
    vi.resetModules()
  })

  it('未配置时默认使用 60 秒 revalidate（站点名在 1 分钟内刷新）', async () => {
    delete process.env[REVALIDATE_KEY]
    const { getServerBranding } = await loadModule()

    const result = await getServerBranding()

    expect(result.text).toBe('新站点名')
    const options = fetchSpy.mock.calls[0]?.[1] as { next?: { revalidate?: number } }
    expect(options.next).toEqual({ revalidate: 60 })
  })

  it('BRANDING_REVALIDATE_SECONDS=0 时走 no-store，不做缓存', async () => {
    process.env[REVALIDATE_KEY] = '0'
    const { getServerBranding } = await loadModule()

    await getServerBranding()

    const options = fetchSpy.mock.calls[0]?.[1] as {
      cache?: string
      next?: { revalidate?: number }
    }
    expect(options.cache).toBe('no-store')
    expect(options.next).toBeUndefined()
  })

  it('显式配置的 revalidate 秒数生效', async () => {
    process.env[REVALIDATE_KEY] = '10'
    const { getServerBranding } = await loadModule()

    await getServerBranding()

    const options = fetchSpy.mock.calls[0]?.[1] as { next?: { revalidate?: number } }
    expect(options.next).toEqual({ revalidate: 10 })
  })

  it('非法配置值回退默认 60 秒', async () => {
    process.env[REVALIDATE_KEY] = 'abc'
    const { getServerBranding } = await loadModule()

    await getServerBranding()

    const options = fetchSpy.mock.calls[0]?.[1] as { next?: { revalidate?: number } }
    expect(options.next).toEqual({ revalidate: 60 })
  })

  it('后端返回空品牌名时回退默认站点名', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ data: { brand_text: '' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    delete process.env[REVALIDATE_KEY]
    const { getServerBranding } = await loadModule()

    const result = await getServerBranding()

    expect(result.text).toBe('AIChat')
    expect(result.isFallback).toBe(true)
    expect(result.theme).toEqual({})
  })

  it('映射后端返回的 Brand Theme 字段', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            brand_text: '新站点名',
            brand_primary: '#AABBCC',
            brand_background: '',
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    delete process.env[REVALIDATE_KEY]
    const { getServerBranding } = await loadModule()

    const result = await getServerBranding()

    expect(result.text).toBe('新站点名')
    expect(result.theme).toEqual({ brand_primary: '#AABBCC' })
    expect(result.isFallback).toBe(false)
  })

  it('fetch 永不响应时在 1.5 秒 deadline 回退默认品牌', async () => {
    vi.useFakeTimers()
    try {
      let receivedSignal: AbortSignal | undefined
      fetchSpy.mockImplementation((_url: unknown, init?: RequestInit) => {
        receivedSignal = init?.signal ?? undefined
        return new Promise<Response>(() => {})
      })
      const { getServerBranding } = await loadModule()

      const pending = getServerBranding()
      await vi.advanceTimersByTimeAsync(1499)
      let settled = false
      void pending.then(() => { settled = true })
      await Promise.resolve()
      expect(settled).toBe(false)

      await vi.advanceTimersByTimeAsync(1)
      await expect(pending).resolves.toEqual({
        text: 'AIChat',
        theme: {},
        isFallback: true,
      })
      expect(receivedSignal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('响应体 json 悬挂时同样在 1.5 秒 deadline 回退', async () => {
    vi.useFakeTimers()
    try {
      let receivedSignal: AbortSignal | undefined
      fetchSpy.mockImplementation((_url: unknown, init?: RequestInit) => {
        receivedSignal = init?.signal ?? undefined
        return Promise.resolve({
        ok: true,
        status: 200,
        json: () => new Promise(() => {}),
        } as unknown as Response)
      })
      const { getServerBranding } = await loadModule()

      const pending = getServerBranding()
      await vi.advanceTimersByTimeAsync(1500)
      await expect(pending).resolves.toEqual({
        text: 'AIChat',
        theme: {},
        isFallback: true,
      })
      // json 悬挂不能只让 Promise.race 结束：同一 signal 必须在 deadline 时中止。
      expect(receivedSignal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('同一请求内重复调用复用同一次 fetch', async () => {
    const { getServerBranding } = await loadModule()

    const [first, second] = await Promise.all([getServerBranding(), getServerBranding()])

    expect(first).toEqual(second)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('use server 模块只导出异步函数，不泄露 deadline 常量', async () => {
    const mod = await loadModule()

    for (const [name, value] of Object.entries(mod)) {
      expect(typeof value, `export ${name} must be a function`).toBe('function')
      if (typeof value === 'function') {
        expect(value.constructor.name, `export ${name} must be async`).toBe('AsyncFunction')
      }
    }
  })
})
