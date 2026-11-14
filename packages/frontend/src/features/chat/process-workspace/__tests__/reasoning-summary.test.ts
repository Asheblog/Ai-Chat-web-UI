import { describe, expect, it } from 'vitest'
import {
  REASONING_SUMMARY_MAX_LENGTH,
  summarizeReasoningSegment,
} from '../model/reasoning-summary'

const codepointLength = (value: string) => Array.from(value).length

describe('推理段内容摘要', () => {
  it('跳过 Markdown 标题，取段内首个有信息量的完整句', () => {
    expect(
      summarizeReasoningSegment('## 分析思路\n\n先确认用户问的是价格，再找官方页面。价格可能已更新。'),
    ).toBe('先确认用户问的是价格，再找官方页面')
  })

  it('列表段取第一条要点，不是盲截整段前 30 个字符', () => {
    expect(
      summarizeReasoningSegment('- 需要把检索结果按官方来源排序\n- 然后用表格对比\n- 最后给出结论'),
    ).toBe('需要把检索结果按官方来源排序')
  })

  it('超长单句在分句处收尾，含省略号不超过 30 个码点', () => {
    const summary = summarizeReasoningSegment(
      '我需要先确认这个问题的具体范围包括时间范围、地域范围以及是否需要给出可引用的官方来源，然后再决定检索关键词。',
    )
    expect(summary).toBe('我需要先确认这个问题的具体范围包括时间范围…')
    expect(codepointLength(summary)).toBeLessThanOrEqual(REASONING_SUMMARY_MAX_LENGTH)
  })

  it('英文按词边界截断，不以空格收尾', () => {
    expect(
      summarizeReasoningSegment(
        'The user wants a price comparison for the three official plans from the vendor site.',
      ),
    ).toBe('The user wants a price…')
  })

  it('清理行内代码与链接地址，只留可读文字', () => {
    expect(
      summarizeReasoningSegment('参考 `pricing.md` 与 [官方定价页](https://example.com/pricing)，先核对币种。'),
    ).toBe('参考 pricing.md 与 官方定价页，先核对币种')
  })

  it('空白与纯引导语不造摘要', () => {
    expect(summarizeReasoningSegment('   \n\t')).toBe('')
    expect(summarizeReasoningSegment('好的。')).toBe('')
    expect(summarizeReasoningSegment('嗯，收到。')).toBe('')
  })

  it('纯代码段取首个非空代码行作标题，可保留标识符但不执行代码', () => {
    expect(summarizeReasoningSegment('```ts\nconst a = 1\nconst b = 2\n```')).toBe('const a = 1')
  })

  it('引导语后接代码时用代码行，不显示引导语', () => {
    expect(summarizeReasoningSegment('好的。\n\n```ts\nconst a = 1\n```')).toBe('const a = 1')
  })

  it('代码行同样收进 30 码点预算', () => {
    const summary = summarizeReasoningSegment(
      '```\nconst veryLongIdentifierName = await fetchOfficialPricingPage(session)\n```',
    )
    expect(summary).toBe('const veryLongIdentifierName…')
    expect(codepointLength(summary)).toBeLessThanOrEqual(30)
  })

  it('emoji 按码点计数，超长段落仍不超过上限并以省略号收尾', () => {
    const summary = summarizeReasoningSegment(
      '我需要先确认 🚀🚀🚀 这个问题的边界，然后再继续分析更多内容以便超过三十个字符的长度。',
    )
    expect(codepointLength(summary)).toBeLessThanOrEqual(REASONING_SUMMARY_MAX_LENGTH)
    expect(summary.endsWith('…')).toBe(true)
  })

  it('emoji 与分句阈值都按码点计算：分句落在前半段时不提前收尾', () => {
    // 10 个 😀（各占 2 个 UTF-16 单元）后紧跟中文逗号：逗号在码点 10，
    // 低于"后半段"阈值 15，应当跳过它继续取满 29 个码点再加省略号。
    const text = `${'😀'.repeat(10)}，我们继续核对官方定价页面的全部细节和币种以及换算方式。`
    const summary = summarizeReasoningSegment(text)

    expect(summary).toBe(`${'😀'.repeat(10)}，我们继续核对官方定价页面的全部细节和…`)
    expect(codepointLength(summary)).toBe(30)
    expect(summary.endsWith('…')).toBe(true)
  })

  it('短语段落原样给出，不套用固定标题', () => {
    expect(summarizeReasoningSegment('先确认时间范围。')).toBe('先确认时间范围')
    expect(summarizeReasoningSegment('先确认时间范围。')).not.toBe('深度思考')
  })
})