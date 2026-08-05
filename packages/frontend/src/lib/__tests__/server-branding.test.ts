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
})
