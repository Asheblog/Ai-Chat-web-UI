import {
  runSearchAutoReadBatch,
  type AutoReadCandidate,
  type AutoReadReadRequest,
} from '../web-search-auto-read'

const candidate = (url: string, extra: Partial<AutoReadCandidate> = {}): AutoReadCandidate => ({
  url,
  title: url,
  ...extra,
})

const okRead = (body = 'page body text') => jest.fn(async () => ({ textContent: body }))

describe('runSearchAutoReadBatch', () => {
  test('reads the same page once even when two hits normalize to the same url', async () => {
    const read = okRead()

    const result = await runSearchAutoReadBatch({
      candidates: [candidate('https://example.com/a/'), candidate('https://example.com/a')],
      read,
      perUrlTimeoutMs: 2000,
      evidenceTarget: 2,
    })

    expect(read).toHaveBeenCalledTimes(1)
    expect(result.duplicateUrls).toEqual(['https://example.com/a'])
    expect(result.candidateCount).toBe(1)
  })

  test('examines at most four ranked candidates', async () => {
    const read = jest.fn(async () => ({ textContent: '', error: 'empty', errorCode: 'EMPTY_CONTENT' }))

    const result = await runSearchAutoReadBatch({
      candidates: [1, 2, 3, 4, 5, 6].map((n) => candidate(`https://example.com/p${n}`)),
      read,
      perUrlTimeoutMs: 2000,
      evidenceTarget: 2,
    })

    expect(result.candidateCount).toBe(4)
    expect(read).toHaveBeenCalledTimes(4)
    expect(result.items).toHaveLength(4)
    expect(result.failedCount).toBe(4)
  })

  test('stops scheduling reads once the evidence target is met', async () => {
    const read = okRead()

    const result = await runSearchAutoReadBatch({
      candidates: [1, 2, 3, 4].map((n) => candidate(`https://example.com/p${n}`)),
      read,
      perUrlTimeoutMs: 2000,
      evidenceTarget: 2,
      parallelism: 1,
    })

    expect(read).toHaveBeenCalledTimes(2)
    expect(result.articleCount).toBe(2)
    expect(result.items[2].skippedReason).toBe('evidence_target_met')
    expect(result.items[2].evidenceKind).toBe('none')
  })

  test('replaces a failed candidate with the next ranked result and keeps the original error', async () => {
    const read = jest.fn(async (request: AutoReadReadRequest) => {
      if (request.url.endsWith('/blocked')) {
        return { textContent: '', error: 'HTTP 403 for /blocked', errorCode: 'HTTP_403' as const }
      }
      return { textContent: `body of ${request.url}` }
    })

    const result = await runSearchAutoReadBatch({
      candidates: ['/blocked', '/b', '/c'].map((p) => candidate(`https://example.com${p}`)),
      read,
      perUrlTimeoutMs: 2000,
      evidenceTarget: 2,
      parallelism: 1,
    })

    expect(read).toHaveBeenCalledTimes(3)
    expect(result.items[0]).toMatchObject({
      evidenceKind: 'none',
      error: 'HTTP 403 for /blocked',
      errorCode: 'HTTP_403',
      fallbackUsed: 'none',
    })
    expect(result.items[1].evidenceKind).toBe('article')
    expect(result.items[2].evidenceKind).toBe('article')
    expect(result.articleCount).toBe(2)
  })

  test('records a search snippet as summary evidence instead of promoting it to article', async () => {
    const read = jest.fn(async () => ({ textContent: '', error: 'Empty content', errorCode: 'EMPTY_CONTENT' }))

    const result = await runSearchAutoReadBatch({
      candidates: [
        candidate('https://example.com/only-snippet', {
          snippet: '搜索结果摘要文本',
          searchContent: { kind: 'snippet', content: '搜索结果摘要文本', source: 'brave' },
        }),
      ],
      read,
      perUrlTimeoutMs: 2000,
      evidenceTarget: 2,
    })

    expect(result.items[0]).toMatchObject({
      evidenceKind: 'summary',
      fallbackUsed: 'search_snippet',
      contentSource: 'brave',
      error: 'Empty content',
      errorCode: 'EMPTY_CONTENT',
    })
    expect(result.items[0].content).toContain('搜索结果摘要文本')
    expect(result.articleCount).toBe(0)
    expect(result.summaryCount).toBe(1)
  })

  test('reuses only article search content and reads the page for snippet-only hits', async () => {
    const read = okRead('fetched body')

    const result = await runSearchAutoReadBatch({
      candidates: [
        candidate('https://example.com/reusable', {
          searchContent: { kind: 'article', content: 'Tavily 正文内容', source: 'tavily' },
        }),
        candidate('https://example.com/snippet-only', {
          snippet: '短摘要',
          searchContent: { kind: 'snippet', content: '短摘要', source: 'brave' },
        }),
      ],
      read,
      perUrlTimeoutMs: 2000,
      evidenceTarget: 2,
      maxCandidates: 2,
    })

    expect(read).toHaveBeenCalledTimes(1)
    expect(result.items[0]).toMatchObject({
      evidenceKind: 'article',
      fallbackUsed: 'search_content',
      contentSource: 'tavily',
    })
    expect(result.items[1]).toMatchObject({ evidenceKind: 'article', fallbackUsed: 'none' })
    expect(result.articleCount).toBe(2)
  })

  test('carries the provider truncation flag for a reused capped body', async () => {
    const read = okRead()

    const result = await runSearchAutoReadBatch({
      candidates: [
        candidate('https://example.com/exa-capped', {
          searchContent: {
            kind: 'article',
            content: 'Exa 正文'.repeat(50),
            source: 'exa',
            truncated: true,
          },
        }),
      ],
      read,
      perUrlTimeoutMs: 2000,
      evidenceTarget: 1,
    })

    expect(read).not.toHaveBeenCalled()
    expect(result.items[0]).toMatchObject({ evidenceKind: 'article', truncated: true })
    // 提供方没有给抓取时间时保持 undefined，不伪造时间
    expect(result.items[0].fetchedAt).toBeUndefined()
  })

  test('keeps a provider fetch time when the provider reports one', async () => {
    const result = await runSearchAutoReadBatch({
      candidates: [
        candidate('https://example.com/exa-time', {
          searchContent: {
            kind: 'article',
            content: 'Exa 正文',
            source: 'exa',
            fetchedAt: '2026-11-16T03:00:00.000Z',
          },
        }),
      ],
      read: okRead(),
      perUrlTimeoutMs: 2000,
      evidenceTarget: 1,
    })

    expect(result.items[0].fetchedAt).toBe('2026-11-16T03:00:00.000Z')
    expect(result.items[0].truncated).toBeUndefined()
  })

  test('marks a reused body sliced by the local character cap as truncated', async () => {
    const result = await runSearchAutoReadBatch({
      candidates: [
        candidate('https://example.com/long', {
          searchContent: { kind: 'article', content: 'A'.repeat(500), source: 'tavily' },
        }),
      ],
      read: okRead(),
      perUrlTimeoutMs: 2000,
      evidenceTarget: 1,
      maxContentChars: 200,
    })

    expect(result.items[0].evidenceKind).toBe('article')
    expect(result.items[0].truncated).toBe(true)
    expect((result.items[0].content || '').length).toBeLessThanOrEqual(201)
  })

  test('leaves a reused body that fits the local cap unmarked', async () => {
    const result = await runSearchAutoReadBatch({
      candidates: [
        candidate('https://example.com/short', {
          searchContent: { kind: 'article', content: 'A'.repeat(120), source: 'tavily' },
        }),
      ],
      read: okRead(),
      perUrlTimeoutMs: 2000,
      evidenceTarget: 1,
      maxContentChars: 200,
    })

    expect(result.items[0].truncated).toBeUndefined()
  })

  test('marks a read body sliced by the local cap as truncated', async () => {
    const result = await runSearchAutoReadBatch({
      candidates: [candidate('https://example.com/read-long')],
      read: okRead('B'.repeat(500)),
      perUrlTimeoutMs: 2000,
      evidenceTarget: 1,
      maxContentChars: 200,
    })

    expect(result.items[0].truncated).toBe(true)
  })

  test('keeps the reader truncation marker even when the text fits the local cap', async () => {
    const result = await runSearchAutoReadBatch({
      candidates: [candidate('https://example.com/read-marked')],
      read: async () => ({ textContent: 'short body', truncated: true }),
      perUrlTimeoutMs: 2000,
      evidenceTarget: 1,
      maxContentChars: 200,
    })

    expect(result.items[0].truncated).toBe(true)
  })

  test('marks a search snippet sliced by the local cap as truncated', async () => {
    const result = await runSearchAutoReadBatch({
      candidates: [
        candidate('https://example.com/snippet-long', {
          snippet: 'C'.repeat(500),
          searchContent: { kind: 'snippet', content: 'C'.repeat(500), source: 'brave' },
        }),
      ],
      read: async () => ({ textContent: '', error: 'Empty content', errorCode: 'EMPTY_CONTENT' as const }),
      perUrlTimeoutMs: 2000,
      evidenceTarget: 1,
      maxContentChars: 200,
    })

    expect(result.items[0].evidenceKind).toBe('summary')
    expect(result.items[0].truncated).toBe(true)
  })

  test('honours the batch deadline and reports the skipped candidates instead of hanging', async () => {
    const read = jest.fn(
      (request: AutoReadReadRequest) =>
        new Promise<{ textContent: string; error: string; errorCode: 'TIMEOUT' }>((resolve) => {
          const finish = () =>
            resolve({ textContent: '', error: 'Request timeout after 5 seconds', errorCode: 'TIMEOUT' })
          if (request.signal.aborted) return finish()
          request.signal.addEventListener('abort', finish, { once: true })
        }),
    )

    const startedAt = Date.now()
    const result = await runSearchAutoReadBatch({
      candidates: [1, 2, 3].map((n) => candidate(`https://example.com/slow${n}`)),
      read,
      perUrlTimeoutMs: 5000,
      // 80ms 只是调度器的内部测试 seam；生产可配置下界是 3000ms，由 handler 与 settings 层校验
      batchTimeoutMs: 80,
      evidenceTarget: 2,
      parallelism: 2,
    })

    expect(Date.now() - startedAt).toBeLessThan(3000)
    expect(result.deadlineExceeded).toBe(true)
    expect(result.items.every((item) => item.errorCode === 'TIMEOUT')).toBe(true)
    expect(result.items[2].skippedReason).toBe('batch_deadline')
  })

  test('starts nothing when the request signal is already aborted', async () => {
    const read = okRead()
    const controller = new AbortController()
    controller.abort()

    const result = await runSearchAutoReadBatch({
      candidates: [candidate('https://example.com/a')],
      read,
      perUrlTimeoutMs: 2000,
      signal: controller.signal,
    })

    expect(read).not.toHaveBeenCalled()
    expect(result.cancelled).toBe(true)
    expect(result.items[0].skippedReason).toBe('cancelled')
  })

  test('keeps concurrent reads within the configured parallelism', async () => {
    let active = 0
    let maxActive = 0
    const read = jest.fn(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 15))
      active -= 1
      return { textContent: `body ${active}` }
    })

    const result = await runSearchAutoReadBatch({
      candidates: [1, 2, 3, 4].map((n) => candidate(`https://example.com/p${n}`)),
      read,
      perUrlTimeoutMs: 3000,
      evidenceTarget: 4,
      parallelism: 2,
    })

    expect(maxActive).toBeLessThanOrEqual(2)
    expect(result.articleCount).toBe(4)
  })
})
