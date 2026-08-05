import {
  shouldIgnoreReasoningMeta,
  stripToolProgressFromReasoning,
} from '@aichat/shared/strip-tool-progress-from-reasoning'

describe('stripToolProgressFromReasoning', () => {
  test('纯模型推理文本不变', () => {
    const input = 'The user wants news.\nI should search first.'
    expect(stripToolProgressFromReasoning(input)).toBe(input)
  })

  test('混杂样本剥离后只剩模型段', () => {
    const input = [
      'The user wants me to analyze today\'s news.',
      '联网搜索：今日新闻（引擎 2，查询 1，目标 10 条，最少来源 2）',
      '搜索后自动读取网页（1/2）：https://example.com/a',
      '网页读取成功：标题（约 100 词）',
      '网页读取失败：https://example.com/b（JS_CHALLENGE）',
      '获得 10 条结果，自动读取正文成功 2 条。',
      'I have enough context now.',
    ].join('\n')

    expect(stripToolProgressFromReasoning(input)).toBe(
      ["The user wants me to analyze today's news.", 'I have enough context now.'].join('\n'),
    )
  })

  test('空串与全工具文案返回空', () => {
    expect(stripToolProgressFromReasoning('')).toBe('')
    expect(stripToolProgressFromReasoning(null)).toBe('')
    expect(stripToolProgressFromReasoning(undefined)).toBe('')
    expect(
      stripToolProgressFromReasoning(
        ['联网搜索：foo', '在会话 workspace 中执行 Python 代码', 'Python 执行完成，准备综合结果。'].join(
          '\n',
        ),
      ),
    ).toBe('')
  })

  test('折叠多余空行', () => {
    const input = ['model step', '', '', '联网搜索：q', '', 'more'].join('\n')
    expect(stripToolProgressFromReasoning(input)).toBe(['model step', '', 'more'].join('\n'))
  })
})

describe('shouldIgnoreReasoningMeta', () => {
  test('kind=tool 忽略，model/缺省不忽略', () => {
    expect(shouldIgnoreReasoningMeta({ kind: 'tool' })).toBe(true)
    expect(shouldIgnoreReasoningMeta({ kind: 'model' })).toBe(false)
    expect(shouldIgnoreReasoningMeta({})).toBe(false)
    expect(shouldIgnoreReasoningMeta(null)).toBe(false)
    expect(shouldIgnoreReasoningMeta(undefined)).toBe(false)
  })
})
