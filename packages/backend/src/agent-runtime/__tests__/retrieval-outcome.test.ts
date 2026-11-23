import {
  createRetrievalEvidenceTally,
  evaluateRetrievalChain,
  isReadEvidenceRetained,
  isRetrievalEvidenceRetained,
  parseRetrievalOutcome,
  recordWebSearchOutcome,
  tallyHasRetainedEvidence,
} from '../retrieval-outcome'

const outcomeContent = (status: string, reason?: string) =>
  JSON.stringify({ retrievalOutcome: { status, ...(reason ? { reason } : {}) } })

describe('parseRetrievalOutcome', () => {
  it('reads the machine-readable block from a serialized tool result', () => {
    const outcome = parseRetrievalOutcome(
      JSON.stringify({
        retrievalOutcome: {
          status: 'partial',
          reason: 'partial_results',
          retryable: true,
          retryAfterMs: 2000,
          degraded: true,
          engines: ['bing'],
        },
      }),
    )

    expect(outcome).toEqual({ status: 'partial', reason: 'partial_results' })
  })

  it('accepts an already-parsed object payload', () => {
    expect(parseRetrievalOutcome({ retrievalOutcome: { status: 'empty', reason: 'no_results' } })).toMatchObject({
      status: 'empty',
      reason: 'no_results',
    })
  })

  it('returns null for unknown status values, plain text bodies and missing blocks', () => {
    expect(parseRetrievalOutcome(JSON.stringify({ retrievalOutcome: { status: 'weird' } }))).toBeNull()
    expect(parseRetrievalOutcome('网页原文输出')).toBeNull()
    expect(parseRetrievalOutcome(JSON.stringify({ results: [] }))).toBeNull()
    expect(parseRetrievalOutcome(undefined)).toBeNull()
  })
})

describe('retrieval evidence verdict', () => {
  it.each(['success', 'partial'])('counts %s as retained evidence', (status) => {
    expect(isRetrievalEvidenceRetained({ status: status as any, reason: null })).toBe(true)
  })

  it.each(['empty', 'failed', 'timeout', 'cancelled'])('does not count %s as retained evidence', (status) => {
    expect(isRetrievalEvidenceRetained({ status: status as any, reason: null })).toBe(false)
  })
})

describe('retrieval evidence tally', () => {
  it('counts rounds by outcome so the closing turn only runs when evidence exists', () => {
    const tally = createRetrievalEvidenceTally()
    expect(tallyHasRetainedEvidence(tally)).toBe(false)

    recordWebSearchOutcome(tally, JSON.stringify({ retrievalOutcome: { status: 'empty', reason: 'no_results' } }))
    recordWebSearchOutcome(tally, JSON.stringify({ retrievalOutcome: { status: 'timeout', reason: 'all_sources_timed_out' } }))
    expect(tallyHasRetainedEvidence(tally)).toBe(false)
    expect(tally).toMatchObject({ rounds: 2, evidenceRounds: 0, empty: 1, failed: 1 })

    recordWebSearchOutcome(tally, JSON.stringify({ retrievalOutcome: { status: 'success', reason: 'results' } }))
    expect(tallyHasRetainedEvidence(tally)).toBe(true)
    expect(tally).toMatchObject({ rounds: 3, evidenceRounds: 1, lastStatus: 'success' })
  })

  it('does not fabricate an outcome for plain-text tool bodies', () => {
    const tally = createRetrievalEvidenceTally()
    recordWebSearchOutcome(tally, '网页原文输出')
    expect(tally.rounds).toBe(0)
  })
})

describe('read_url machine-readable results', () => {
  it('parses the failure payload that read_url returns as bare JSON', () => {
    const outcome = parseRetrievalOutcome(
      JSON.stringify({
        url: 'https://example.com/a',
        retrievalOutcome: { status: 'failed', reason: 'read_failed' },
        evidenceSummary: { source: 'origin', results: 0, read: 0, readFailed: 1 },
      }),
    )

    expect(outcome).toEqual({ status: 'failed', reason: 'read_failed' })
    expect(isRetrievalEvidenceRetained(outcome)).toBe(false)
  })

  it('counts a successful read only when its trailing summary reports content', () => {
    const success = [
      '正文：该公司发布了 2026 年第一季度财报。',
      '',
      '## 检索摘要',
      JSON.stringify({ source: 'origin', queries: [], results: 1, read: 1, readFailed: 0 }),
    ].join('\n')
    expect(isReadEvidenceRetained(success)).toBe(true)

    const summaryOnly = [
      '摘要：财报要点若干。',
      '',
      '## 检索摘要',
      JSON.stringify({ source: 'provider', queries: [], results: 1, read: 0, readFailed: 0 }),
    ].join('\n')
    // 只拿到摘要没有正文：仍算带回内容（results>=1 且没有失败）
    expect(isReadEvidenceRetained(summaryOnly)).toBe(true)
  })

  it('does not treat a failed read, plain text or an empty body as evidence', () => {
    const failed = [
      '读取失败',
      '## 检索摘要',
      JSON.stringify({ source: 'origin', results: 0, read: 0, readFailed: 1 }),
    ].join('\n')
    expect(isReadEvidenceRetained(failed)).toBe(false)
    expect(isReadEvidenceRetained('网页原文输出')).toBe(false)
    expect(isReadEvidenceRetained('')).toBe(false)
  })
})

describe('retrieval chain exhaustion', () => {
  it('ends the chain at once when every engine is cooling down', () => {
    const tally = createRetrievalEvidenceTally()
    recordWebSearchOutcome(tally, outcomeContent('failed', 'all_sources_cooling_down'), 0)

    expect(evaluateRetrievalChain(tally, 0)).toBe('sources_cooling_down')
  })

  it('ends the chain at once when there is no active engine', () => {
    const tally = createRetrievalEvidenceTally()
    recordWebSearchOutcome(tally, outcomeContent('failed', 'no_active_engine'), 0)

    expect(evaluateRetrievalChain(tally, 0)).toBe('no_active_engine')
  })

  it('keeps one recovery opportunity before ending repeated failed rounds', () => {
    const tally = createRetrievalEvidenceTally()

    recordWebSearchOutcome(tally, outcomeContent('timeout', 'all_sources_timed_out'), 0)
    expect(evaluateRetrievalChain(tally, 0)).toBeNull()

    recordWebSearchOutcome(tally, outcomeContent('failed', 'all_sources_failed'), 1)
    expect(evaluateRetrievalChain(tally, 1)).toBe('repeated_no_progress')
  })

  it('treats a normal zero-hit round as progress instead of exhaustion', () => {
    const tally = createRetrievalEvidenceTally()

    recordWebSearchOutcome(tally, outcomeContent('empty', 'no_results'), 0)
    expect(evaluateRetrievalChain(tally, 0)).toBeNull()

    recordWebSearchOutcome(tally, outcomeContent('failed', 'all_sources_failed'), 1)
    // 零命中已清零计数：这次失败仍是第一次，保留恢复机会
    expect(evaluateRetrievalChain(tally, 1)).toBeNull()
  })

  it('does not end the chain when the round retained evidence or was cancelled', () => {
    const tally = createRetrievalEvidenceTally()

    recordWebSearchOutcome(tally, outcomeContent('failed', 'all_sources_cooling_down'), 0)
    recordWebSearchOutcome(tally, outcomeContent('partial', 'partial_results'), 0)
    expect(evaluateRetrievalChain(tally, 0)).toBeNull()

    recordWebSearchOutcome(tally, outcomeContent('cancelled', 'request_cancelled'), 1)
    expect(evaluateRetrievalChain(tally, 1)).toBeNull()
  })

  it('never ends a mixed round: a cooling search must not cut off a usable read_url chain', () => {
    const tally = createRetrievalEvidenceTally()

    recordWebSearchOutcome(tally, outcomeContent('failed', 'all_sources_cooling_down'), 0)
    expect(evaluateRetrievalChain(tally, 0, ['web_search', 'read_url'])).toBeNull()
  })

  it('lets a mixed round break the consecutive no-progress counter', () => {
    const tally = createRetrievalEvidenceTally()

    // 第 1 轮：纯检索全失败 → 计数 1
    recordWebSearchOutcome(tally, outcomeContent('failed', 'all_sources_failed'), 0)
    expect(evaluateRetrievalChain(tally, 0, ['web_search'])).toBeNull()

    // 第 2 轮：混合了 read_url，可能仍有产出 → 清零
    recordWebSearchOutcome(tally, outcomeContent('failed', 'all_sources_failed'), 1)
    expect(evaluateRetrievalChain(tally, 1, ['web_search', 'read_url'])).toBeNull()

    // 第 3 轮：再次纯检索全失败，但只是新的第一次，保留恢复机会
    recordWebSearchOutcome(tally, outcomeContent('failed', 'all_sources_failed'), 2)
    expect(evaluateRetrievalChain(tally, 2, ['web_search'])).toBeNull()
    expect(tally.consecutiveNoProgressRounds).toBe(1)
  })

  it('ignores rounds without any retrieval outcome', () => {
    const tally = createRetrievalEvidenceTally()
    expect(evaluateRetrievalChain(tally, 0)).toBeNull()
  })

  it('settles each round only once', () => {
    const tally = createRetrievalEvidenceTally()
    recordWebSearchOutcome(tally, outcomeContent('failed', 'all_sources_cooling_down'), 0)

    expect(evaluateRetrievalChain(tally, 0)).toBe('sources_cooling_down')
    expect(evaluateRetrievalChain(tally, 0)).toBeNull()
  })
})
