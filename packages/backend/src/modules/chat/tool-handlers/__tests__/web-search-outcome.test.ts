jest.mock('../../../../utils/remote-image-reader', () => ({
  readRemoteImages: jest.fn(),
}))

import { WebSearchToolHandler } from '../web-search-handler'
import { EngineBackoffRegistry, resetWebSearchBackoff } from '../web-search-backoff'
import { clearSearchEvidenceStore } from '../web-search-evidence-store'
import { mapReadFailureKind, mapReadFailureProjection } from '../web-search-outcome'
import { RETRYABLE_WEB_SEARCH_FAILURE_KINDS } from '../../../../utils/web-search'

const urlReaderModule = require('../../../../utils/url-reader')
const imageReaderModule = require('../../../../utils/remote-image-reader')

const createConfig = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  engines: ['tavily'],
  apiKeys: { tavily: 'tv-key' },
  resultLimit: 5,
  domains: [],
  scope: 'webpage',
  autoReadAfterSearch: true,
  autoReadTopK: 0,
  parallelMaxEngines: 1,
  autoBilingualMode: 'off',
  ...overrides,
})

const createContext = (overrides: Record<string, unknown> = {}) => ({
  sessionId: 1,
  actorIdentifier: 'user:test',
  actorUserId: 1,
  messageId: 10,
  connectionId: 100,
  emitReasoning: jest.fn(),
  sendToolEvent: jest.fn(),
  ...overrides,
})

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })

const tavilyBody = (results: unknown[]) => jsonResponse({ results })
const braveBody = (results: unknown[]) => jsonResponse({ web: { results } })

/** 模拟真实 fetch：请求被中止时以 AbortError 拒绝，用于验证取消与子任务超时。 */
const abortableFetch = (handler: (input: any, init?: RequestInit) => Response | Promise<Response>) =>
  jest.fn((input: any, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const signal = init?.signal
    const fail = () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }))
    if (signal?.aborted) return fail()
    signal?.addEventListener('abort', fail, { once: true })
    Promise.resolve(handler(input, init)).then((response) => {
      if (signal?.aborted) return
      resolve(response)
    }, reject)
  }))

const hangingFetch = () =>
  jest.fn((_input: any, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal
    const fail = () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }))
    if (signal?.aborted) return fail()
    signal?.addEventListener('abort', fail, { once: true })
  }))

const runSearch = async (
  handler: WebSearchToolHandler,
  args: Record<string, unknown>,
  context: Record<string, unknown>,
  callId = 'call_search',
) => {
  const result = await handler.handle(
    { id: callId, function: { name: 'web_search', arguments: '{}' } },
    args,
    context as any,
  )
  return { result, payload: JSON.parse(String(result.message.content)) }
}

describe('web_search retrievalOutcome', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    resetWebSearchBackoff()
    clearSearchEvidenceStore()
  })

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  test('全失败与成功零条必须可区分：failed/all_sources_failed 且可重试', async () => {
    global.fetch = jest.fn(async () => new Response('upstream error', { status: 500 })) as any

    const { payload } = await runSearch(
      new WebSearchToolHandler(createConfig() as any),
      { query: 'q' },
      createContext(),
    )

    expect(payload.error).toBeUndefined()
    expect(payload.retrievalOutcome).toMatchObject({
      status: 'failed',
      reason: 'all_sources_failed',
      retryable: true,
      degraded: true,
    })
    expect(payload.retrievalOutcome.search).toMatchObject({
      attempted: 1,
      succeeded: 0,
      failed: 1,
      empty: 0,
      exhaustion: 'all_failed',
    })
    expect(payload.retrievalOutcome.engines).toEqual([
      expect.objectContaining({
        engine: 'tavily',
        state: 'error',
        failureKind: 'upstream_error',
        httpStatus: 500,
      }),
    ])
    expect(payload.evidenceSummary).toMatchObject({ results: 0, read: 0, readFailed: 0, failures: [] })
    expect(payload.summary).toContain('失败')
  })

  test('上游成功但零条：empty/no_results 且不可重试', async () => {
    global.fetch = jest.fn(async () => tavilyBody([])) as any

    const { payload } = await runSearch(
      new WebSearchToolHandler(createConfig() as any),
      { query: 'q' },
      createContext(),
    )

    expect(payload.retrievalOutcome).toMatchObject({
      status: 'empty',
      reason: 'no_results',
      retryable: false,
      degraded: false,
    })
    expect(payload.retrievalOutcome.search).toMatchObject({ succeeded: 1, failed: 0, empty: 1 })
    expect(payload.retrievalOutcome.engines).toEqual([
      expect.objectContaining({ engine: 'tavily', state: 'ok' }),
    ])
    expect(payload.hits).toEqual([])
  })

  test('取消不包装成工具错误，且不再发起升级请求', async () => {
    const fetchMock = hangingFetch()
    global.fetch = fetchMock as any
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 30)

    const { payload } = await runSearch(
      new WebSearchToolHandler(
        createConfig({ engines: ['tavily', 'exa'], apiKeys: { tavily: 'tv-key', exa: 'ex-key' }, parallelMaxEngines: 2 }) as any,
      ),
      { query: 'q' },
      createContext({ requestSignal: controller.signal }),
      'call_cancel',
    )

    expect(payload.error).toBeUndefined()
    expect(payload.retrievalOutcome).toMatchObject({
      status: 'cancelled',
      reason: 'request_cancelled',
      cancellation: { requested: true, source: 'request' },
    })
    expect(payload.retrievalOutcome.engines.every((item: any) => item.state === 'cancelled')).toBe(true)
    const callsAfterAbort = fetchMock.mock.calls.length
    expect(callsAfterAbort).toBeLessThanOrEqual(2)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterAbort)
  })

  test('子任务超时：timeout/all_sources_timed_out', async () => {
    global.fetch = hangingFetch() as any

    const { payload } = await runSearch(
      new WebSearchToolHandler(createConfig({ parallelTimeoutMs: 1000 }) as any),
      { query: 'q' },
      createContext(),
    )

    expect(payload.retrievalOutcome).toMatchObject({
      status: 'timeout',
      reason: 'all_sources_timed_out',
      retryable: true,
    })
    expect(payload.retrievalOutcome.search).toMatchObject({ timedOut: 1, cancelled: 0 })
    expect(payload.retrievalOutcome.engines).toEqual([
      expect.objectContaining({ engine: 'tavily', state: 'timed_out', failureKind: 'timeout' }),
    ])
  })

  test('部分来源失败仍交付结果：partial/partial_results 且标记降级', async () => {
    global.fetch = jest.fn(async (input: any) => {
      if (String(input).includes('tavily')) return new Response('boom', { status: 500 })
      return braveBody([{ title: 'Brave hit', url: 'https://news.example.com/b', description: 'd' }])
    }) as any

    const { payload } = await runSearch(
      new WebSearchToolHandler(
        createConfig({
          engines: ['tavily', 'brave'],
          apiKeys: { tavily: 'tv-key', brave: 'br-key' },
          parallelMaxEngines: 2,
        }) as any,
      ),
      { query: 'OpenAI release notes' },
      createContext(),
    )

    expect(payload.retrievalOutcome).toMatchObject({
      status: 'partial',
      reason: 'partial_results',
      retryable: true,
      degraded: true,
    })
    expect(payload.retrievalOutcome.search).toMatchObject({ succeeded: 1, failed: 1 })
    expect(payload.hits).toHaveLength(1)
    expect(payload.retrievalOutcome.engines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ engine: 'tavily', state: 'error' }),
        expect.objectContaining({ engine: 'brave', state: 'ok' }),
      ]),
    )
  })

  test('429 保留 Retry-After 提示但不推断配额或账户成因', async () => {
    global.fetch = jest.fn(async () =>
      new Response('rate limited', { status: 429, headers: { 'retry-after': '3' } })) as any

    const { payload } = await runSearch(
      new WebSearchToolHandler(createConfig() as any),
      { query: 'q' },
      createContext(),
    )

    expect(payload.retrievalOutcome.retryable).toBe(true)
    expect(payload.retrievalOutcome.retryAfterMs).toBe(3000)
    expect(payload.retrievalOutcome.engines[0]).toMatchObject({
      engine: 'tavily',
      state: 'error',
      failureKind: 'rate_limited',
      httpStatus: 429,
      retryAfterMs: 3000,
    })
    const engineText = JSON.stringify(payload.retrievalOutcome.engines)
    expect(engineText).not.toMatch(/quota|billing|account|余额|配额/i)
  })

  test('持续失败按凭据身份隔离退避，可用引擎继续服务', async () => {
    const failingFetch = jest.fn(async () => new Response('boom', { status: 500 }))
    global.fetch = failingFetch as any
    const failingConfig = createConfig()

    for (const callId of ['call_fail_1', 'call_fail_2']) {
      await runSearch(new WebSearchToolHandler(failingConfig as any), { query: 'q' }, createContext(), callId)
    }

    const mixedFetch = jest.fn(async (input: any) => {
      if (String(input).includes('tavily')) return new Response('boom', { status: 500 })
      return braveBody([{ title: 'Brave hit', url: 'https://news.example.com/b', description: 'd' }])
    })
    global.fetch = mixedFetch as any

    const { payload } = await runSearch(
      new WebSearchToolHandler(
        createConfig({
          engines: ['tavily', 'brave'],
          apiKeys: { tavily: 'tv-key', brave: 'br-key' },
          parallelMaxEngines: 2,
        }) as any,
      ),
      { query: 'OpenAI release notes' },
      createContext(),
      'call_mixed',
    )

    expect(mixedFetch.mock.calls.every(([input]) => String(input).includes('brave'))).toBe(true)
    expect(payload.retrievalOutcome.search.skippedBackoff).toBeGreaterThanOrEqual(1)
    expect(payload.retrievalOutcome.engines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ engine: 'tavily', state: 'skipped_backoff' }),
      ]),
    )
    expect(payload.hits).toHaveLength(1)

    // 同一引擎换了一份轮换后的凭据：属于不同身份，不继承退避
    const rotatedFetch = jest.fn(async (input: any) => {
      if (String(input).includes('tavily')) return tavilyBody([{ title: 'T', url: 'https://example.com/t', content: 'c' }])
      return braveBody([])
    })
    global.fetch = rotatedFetch as any
    const rotated = await runSearch(
      new WebSearchToolHandler(
        createConfig({
          engines: ['tavily', 'brave'],
          apiKeys: { tavily: 'tv-key-rotated', brave: 'br-key' },
          parallelMaxEngines: 2,
        }) as any,
      ),
      { query: 'OpenAI release notes' },
      createContext(),
      'call_rotated',
    )
    expect(rotatedFetch.mock.calls.some(([input]) => String(input).includes('tavily'))).toBe(true)
    expect(rotated.payload.retrievalOutcome.search.skippedBackoff).toBe(0)
  })

  test('全部引擎冷却时仍允许一次探测，不把整轮硬判失败', async () => {
    global.fetch = jest.fn(async () => new Response('boom', { status: 500 })) as any
    const config = createConfig()
    for (const callId of ['call_cool_1', 'call_cool_2']) {
      await runSearch(new WebSearchToolHandler(config as any), { query: 'q' }, createContext(), callId)
    }

    const probeFetch = jest.fn(async () => new Response('boom', { status: 500 }))
    global.fetch = probeFetch as any
    const { payload } = await runSearch(
      new WebSearchToolHandler(config as any),
      { query: 'q' },
      createContext(),
      'call_probe',
    )

    expect(probeFetch).toHaveBeenCalledTimes(1)
    expect(payload.retrievalOutcome.search.exhaustion).toBe('all_cooling_down')
    expect(payload.retrievalOutcome.engines[0].state).not.toBe('skipped_backoff')
  })

  test('取消优先于退避探测：已取消的请求不触发任何引擎调用', async () => {
    global.fetch = jest.fn(async () => new Response('boom', { status: 500 })) as any
    const config = createConfig()
    for (const callId of ['call_cancel_1', 'call_cancel_2']) {
      await runSearch(new WebSearchToolHandler(config as any), { query: 'q' }, createContext(), callId)
    }

    const probeFetch = jest.fn()
    global.fetch = probeFetch as any
    const controller = new AbortController()
    controller.abort()
    const context = createContext({ requestSignal: controller.signal })
    const { payload } = await runSearch(
      new WebSearchToolHandler(config as any),
      { query: 'q' },
      context,
      'call_cancelled_probe',
    )

    expect(probeFetch).not.toHaveBeenCalled()
    expect(payload.retrievalOutcome.status).toBe('cancelled')
    // 全部冷却的取消支路也必须发布父 result 事件，否则前端只会看到「开始」没有结论
    const events = (context.sendToolEvent as any).mock.calls.map(([event]: any[]) => event)
    const resultEvents = events.filter((event: any) => event.stage === 'result')
    expect(resultEvents).toHaveLength(1)
    expect(resultEvents[0]).toMatchObject({ stage: 'result', details: { cancelled: true } })
    expect(resultEvents[0].details.retrievalOutcome.status).toBe('cancelled')
    expect(resultEvents[0].details.evidenceSummary).toMatchObject({ source: 'search', read: 0 })
    expect(payload.error).toBeUndefined()
  })

  test('进入引擎前取消也只发布一条父 result 事件，不发起任何请求', async () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock as any
    const controller = new AbortController()
    controller.abort()
    const context = createContext({ requestSignal: controller.signal })

    const { payload } = await runSearch(
      new WebSearchToolHandler(createConfig() as any),
      { query: 'q' },
      context,
      'call_cancelled_early',
    )

    const events = (context.sendToolEvent as any).mock.calls.map(([event]: any[]) => event)
    expect(events.filter((event: any) => event.stage === 'result')).toHaveLength(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(payload.retrievalOutcome.status).toBe('cancelled')
    expect(payload.error).toBeUndefined()
  })

  test('初始轮零命中且已配置 Exa 时升级到 Exa 兜底', async () => {
    const fetchMock = jest.fn(async (input: any) => {
      const url = String(input)
      if (url.includes('exa')) {
        return jsonResponse({
          results: [{ title: 'Exa hit', url: 'https://example.com/exa-hit', text: 'exa body'.repeat(40) }],
        })
      }
      return new Response('boom', { status: 500 })
    })
    global.fetch = fetchMock as any

    const { payload } = await runSearch(
      new WebSearchToolHandler(
        createConfig({
          engines: ['tavily', 'metaso', 'exa'],
          apiKeys: { tavily: 'tv-key', metaso: 'mt-key', exa: 'ex-key' },
          parallelMaxEngines: 3,
          minSources: 1,
        }) as any,
      ),
      { query: 'q' },
      createContext(),
    )

    expect(payload.escalation).toMatchObject({ triggered: true, engine: 'exa' })
    expect(payload.retrievalOutcome.escalation).toMatchObject({ triggered: true, engine: 'exa', reason: 'exa_fallback' })
    expect(payload.hits).toHaveLength(1)
    expect(payload.retrievalOutcome.status).toBe('partial')
    expect(payload.retrievalOutcome.reason).toBe('partial_results')
  })
})

describe('EngineBackoffRegistry', () => {
  test('阈值、指数退避、半开单飞与恢复', () => {
    let now = 0
    const registry = new EngineBackoffRegistry({ now: () => now, threshold: 2, baseMs: 1000, factor: 2, maxMs: 8000 })
    const key = 'engine|credential'

    expect(registry.inspect(key)).toMatchObject({ blocked: false, probe: false, retryAfterMs: 0 })
    registry.recordFailure(key, 'upstream_error')
    expect(registry.inspect(key).blocked).toBe(false)

    registry.recordFailure(key, 'upstream_error')
    expect(registry.inspect(key)).toMatchObject({ blocked: true, retryAfterMs: 1000 })

    now = 1000
    expect(registry.inspect(key)).toMatchObject({ blocked: false, probe: true })
    expect(registry.acquireProbe(key)).toBe(true)
    expect(registry.acquireProbe(key)).toBe(false)

    registry.recordFailure(key, 'upstream_error')
    expect(registry.inspect(key)).toMatchObject({ blocked: true, retryAfterMs: 2000 })

    now = 3000
    expect(registry.inspect(key)).toMatchObject({ blocked: false, probe: true })
    expect(registry.acquireProbe(key)).toBe(true)
    registry.recordSuccess(key)
    expect(registry.inspect(key)).toMatchObject({ blocked: false, probe: false, retryAfterMs: 0 })
  })

  test('429 按 Retry-After 直接开启并封顶', () => {
    let now = 0
    const registry = new EngineBackoffRegistry({ now: () => now, threshold: 2, baseMs: 1000, factor: 2, maxMs: 5000 })
    registry.recordFailure('k', 'rate_limited', { retryAfterMs: 12_000 })
    expect(registry.inspect('k')).toMatchObject({ blocked: true, retryAfterMs: 5000 })
  })

  test('取消、缺凭据与不支持不计入退避', () => {
    const registry = new EngineBackoffRegistry({ threshold: 1 })
    for (const kind of ['cancelled', 'no_credential', 'unsupported', 'invalid_response'] as const) {
      registry.recordFailure('k', kind)
      expect(registry.inspect('k').blocked).toBe(false)
    }
  })

  test('有界：条目数上限内按最久未用淘汰', () => {
    let now = 0
    const registry = new EngineBackoffRegistry({ now: () => now, threshold: 1, baseMs: 1000, maxEntries: 2 })
    registry.recordFailure('a', 'upstream_error')
    now += 1
    registry.recordFailure('b', 'upstream_error')
    now += 1
    registry.recordFailure('c', 'upstream_error')
    expect(registry.inspect('a').blocked).toBe(false)
    expect(registry.inspect('b').blocked).toBe(true)
    expect(registry.inspect('c').blocked).toBe(true)
    expect(registry.size()).toBe(2)
  })
})

describe('失败投影的单一事实源', () => {
  test('可重试种类只有一处定义，取消/缺凭据/不支持/无效响应都不计入', () => {
    expect(Array.from(RETRYABLE_WEB_SEARCH_FAILURE_KINDS).sort()).toEqual([
      'network',
      'rate_limited',
      'timeout',
      'upstream_error',
    ])
  })

  test('读取失败的两套投影来自同一张表，实质分歧保留', () => {
    // 实质分歧：同一错误码在 failureKind 与 reason 上取值不同，合并时不能压平
    expect(mapReadFailureProjection('HTTP_403')).toEqual({
      failureKind: 'upstream_error',
      reason: 'blocked',
    })
    expect(mapReadFailureProjection('EMPTY_CONTENT')).toEqual({
      failureKind: 'invalid_response',
      reason: 'empty',
    })
    expect(mapReadFailureProjection('BODY_TOO_LARGE')).toEqual({
      failureKind: 'upstream_error',
      reason: 'too_large',
    })
    expect(mapReadFailureProjection('TIMEOUT')).toEqual({ failureKind: 'timeout', reason: 'timeout' })
    expect(mapReadFailureProjection('FETCH_FAILED')).toEqual({ failureKind: 'network', reason: 'network' })
    expect(mapReadFailureKind('CANCELLED')).toBe('cancelled')
    expect(mapReadFailureProjection(undefined)).toEqual({
      failureKind: 'upstream_error',
      reason: 'unknown',
    })
  })
})

describe('半开探测锁的释放', () => {
  test('已取得半开锁后遇到不可重试失败：不推进冷却但释放锁，随后仍能探测', () => {
    let now = 0
    const registry = new EngineBackoffRegistry({
      now: () => now,
      threshold: 2,
      baseMs: 1000,
      factor: 2,
      maxMs: 8000,
      minProbeIntervalMs: 0,
    })
    const key = 'engine|credential'
    registry.recordFailure(key, 'upstream_error')
    now += 1
    registry.recordFailure(key, 'upstream_error')
    const coolingBefore = registry.inspect(key)
    expect(coolingBefore.blocked).toBe(true)

    // 冷却期内的一次受控探测先把锁拿在手上
    expect(registry.acquireProbe(key, { allowCooling: true })).toBe(true)
    // 探测结果是不可重试失败：冷却不推进，但锁必须释放
    registry.recordFailure(key, 'unsupported')
    expect(registry.inspect(key)).toEqual(coolingBefore)
    expect(registry.acquireProbe(key, { allowCooling: true })).toBe(true)
  })

  test('取消同样不推进冷却，并释放已取得的探测锁', () => {
    let now = 0
    const registry = new EngineBackoffRegistry({
      now: () => now,
      threshold: 2,
      baseMs: 1000,
      factor: 2,
      maxMs: 8000,
      minProbeIntervalMs: 0,
    })
    const key = 'engine|credential'
    registry.recordFailure(key, 'rate_limited')
    now += 1
    registry.recordFailure(key, 'rate_limited')
    expect(registry.acquireProbe(key, { allowCooling: true })).toBe(true)

    registry.recordFailure(key, 'cancelled')
    expect(registry.inspect(key)).toMatchObject({ blocked: true })
    expect(registry.acquireProbe(key, { allowCooling: true })).toBe(true)
  })
})
