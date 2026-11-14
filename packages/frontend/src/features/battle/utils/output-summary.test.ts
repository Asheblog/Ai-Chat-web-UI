import { describe, expect, it } from 'vitest'
import { getOutputSummary } from './output-summary'
describe('Battle output preview', () => {
  it('shows readable answer text rather than markdown syntax', () => {
    expect(getOutputSummary('## 模型 A · 第一次\n\n**结论**：[政策原文](https://example.test/policy)\n- 已核对 `日期`')).toBe('模型 A · 第一次 结论：政策原文 已核对 日期')
  })
  it('keeps null empty and truncates only the displayed preview', () => {
    expect(getOutputSummary(null)).toBe('')
    expect(getOutputSummary('中文摘要很长', 4)).toBe('中文摘要...')
  })
})
