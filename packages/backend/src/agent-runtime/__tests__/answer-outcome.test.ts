import {
  buildAnswerOutcomeTracePayload,
  classifyAnswerOutcome,
  type ProviderAnswerSignal,
} from '../answer-outcome'

describe('classifyAnswerOutcome: provider 结构化原因优先', () => {
  it('treats a chat-completions content_filter finish reason as not delivered even when text exists', () => {
    const outcome = classifyAnswerOutcome({
      content: '这是一段看起来像回答的正文。',
      signal: { finishReason: 'content_filter' },
    })

    expect(outcome.delivered).toBe(false)
    expect(outcome.reason).toBe('provider_content_filter')
    expect(outcome.source).toBe('provider_signal')
    expect(outcome.suspectedInterception).toBe(false)
    expect(outcome.contentLength).toBe('这是一段看起来像回答的正文。'.length)
  })

  it('treats a structured refusal field as not delivered without judging the text', () => {
    const outcome = classifyAnswerOutcome({
      content: '',
      signal: { refusalText: 'I cannot help with that request.' },
    })

    expect(outcome.delivered).toBe(false)
    expect(outcome.reason).toBe('provider_refusal')
    expect(outcome.source).toBe('provider_signal')
  })

  it('treats a Responses API incomplete content filter as not delivered', () => {
    const outcome = classifyAnswerOutcome({
      content: '部分内容',
      signal: { responseStatus: 'incomplete', incompleteReason: 'content_filter' },
    })

    expect(outcome.delivered).toBe(false)
    expect(outcome.reason).toBe('provider_content_filter')
  })

  it('treats a failed response status as not delivered', () => {
    const outcome = classifyAnswerOutcome({
      content: 'partial',
      signal: { responseStatus: 'failed' },
    })

    expect(outcome.delivered).toBe(false)
    expect(outcome.reason).toBe('provider_failed')
  })

  it('keeps a token-truncated answer as delivered but marks it truncated', () => {
    const outcome = classifyAnswerOutcome({
      content: '这是一份被截断的长回答开头。',
      signal: { responseStatus: 'incomplete', incompleteReason: 'max_output_tokens' },
    })

    expect(outcome.delivered).toBe(true)
    expect(outcome.truncated).toBe(true)
    expect(outcome.reason).toBeNull()
  })
})

describe('classifyAnswerOutcome: 已知固定话术只归类', () => {
  it.each([
    ['抱歉，我不能协助完成这个请求。', 'zh-cannot-assist'],
    ['作为AI语言模型，我无法访问互联网。', 'zh-ai-cannot-browse'],
    ['我无法提供实时信息。', 'zh-realtime-unavailable'],
    ["I'm sorry, but I can't assist with that.", 'en-cannot-assist'],
    ['As an AI language model, I cannot browse the internet.', 'en-ai-cannot-browse'],
  ])('classifies %s as a suspected interception hint', (content, hintId) => {
    const outcome = classifyAnswerOutcome({ content, signal: {} })

    expect(outcome.delivered).toBe(false)
    expect(outcome.reason).toBe('fixed_hint_phrase')
    expect(outcome.source).toBe('content_hint')
    expect(outcome.suspectedInterception).toBe(true)
    expect(outcome.matchedHintId).toBe(hintId)
  })

  it('does not classify a long real answer that merely quotes a refusal sentence', () => {
    const content =
      '这篇报道讨论了几家厂商对内容审核的回应。其中一家在声明里写道“抱歉，我们无法提供该数据”，' +
      '随后补充了季度营收、同比增长以及下一年度的资本开支计划，并给出三家投行的解读与两份原始财报链接。' +
      '综合来看，争议集中在数据口径而不是审核政策本身，读者应以下游财报原文为准，不要只引用媒体转述。'

    const outcome = classifyAnswerOutcome({ content, signal: {} })

    expect(outcome.delivered).toBe(true)
    expect(outcome.suspectedInterception).toBe(false)
    expect(outcome.matchedHintId).toBeNull()
  })

  it('does not classify an ordinary short answer as a hint', () => {
    const outcome = classifyAnswerOutcome({ content: '2026 年 3 月 5 日，该公司发布了 Q4 财报。', signal: {} })
    expect(outcome.delivered).toBe(true)
    expect(outcome.reason).toBeNull()
  })

  it('prefers the structured provider reason over hint detection', () => {
    const signal: ProviderAnswerSignal = { finishReason: 'content_filter' }
    const outcome = classifyAnswerOutcome({ content: '抱歉，我不能协助完成这个请求。', signal })

    expect(outcome.reason).toBe('provider_content_filter')
    expect(outcome.source).toBe('provider_signal')
    expect(outcome.matchedHintId).toBeNull()
  })

  it('reports empty content as its own reason', () => {
    const outcome = classifyAnswerOutcome({ content: '   ', signal: {} })

    expect(outcome.delivered).toBe(false)
    expect(outcome.reason).toBe('empty_content')
    expect(outcome.source).toBe('none')
  })
})

describe('buildAnswerOutcomeTracePayload', () => {
  it('records delivery, reason, source and size without copying the answer body', () => {
    const content = '抱歉，我不能协助完成这个请求。'
    const outcome = classifyAnswerOutcome({ content, signal: { finishReason: 'stop' } })
    const payload = buildAnswerOutcomeTracePayload(outcome)

    expect(payload).toMatchObject({
      delivered: false,
      reason: 'fixed_hint_phrase',
      source: 'content_hint',
      suspectedInterception: true,
      matchedHintId: 'zh-cannot-assist',
      contentLength: content.length,
      finishReason: 'stop',
    })
    expect(Object.values(payload).some((value) => value === content)).toBe(false)
    expect(JSON.stringify(payload).includes(content)).toBe(false)
  })
})
