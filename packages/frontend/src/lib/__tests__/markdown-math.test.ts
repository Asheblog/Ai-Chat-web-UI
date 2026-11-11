import { describe, expect, it } from 'vitest'
import { containsMath } from '@/lib/markdown-math'

describe('containsMath', () => {
  it('detects inline and block delimiters', () => {
    expect(containsMath('质能方程 $E=mc^2$')).toBe(true)
    expect(containsMath('$$\n\\int_0^1 x dx\n$$')).toBe(true)
    expect(containsMath('行内 \\(a+b\\) 结束')).toBe(true)
    expect(containsMath('\\[a^2+b^2=c^2\\]')).toBe(true)
  })

  it('detects chemistry and environments', () => {
    expect(containsMath('反应：\\ce{2H2 + O2 -> 2H2O}')).toBe(true)
    expect(containsMath('\\pu{1.5 kg}')).toBe(true)
    expect(containsMath('\\begin{aligned}a&=1\\\\b&=2\\end{aligned}')).toBe(true)
  })

  it('ignores code blocks and escaped dollars', () => {
    expect(containsMath('\u0060\u0060\u0060bash\necho $HOME $PATH\n\u0060\u0060\u0060')).toBe(false)
    expect(containsMath('行内代码 \u0060$x$\u0060 不算公式')).toBe(false)
    expect(containsMath('价格 \\$5 和 \\$10')).toBe(false)
  })

  it('ignores ordinary text and single currency signs', () => {
    expect(containsMath('')).toBe(false)
    expect(containsMath('这是一段普通中文，没有公式。')).toBe(false)
    expect(containsMath('价格是 $5。')).toBe(false)
    expect(containsMath('**加粗** 与 [链接](https://example.com)')).toBe(false)
  })
})
