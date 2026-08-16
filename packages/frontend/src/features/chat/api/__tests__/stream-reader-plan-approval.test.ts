import { describe, expect, it } from 'vitest'
import { describeTool } from '@aichat/shared/tool-events'
import { normalizeChunk } from '../stream-reader'

describe('stream-reader research plan approval payloads', () => {
  it('preserves streamStatus on legacy complete chunks', () => {
    const chunk = normalizeChunk({
      type: 'complete',
      content: '深度研究已取消',
      streamStatus: 'cancelled',
    })

    expect(chunk).toEqual({
      type: 'complete',
      content: '深度研究已取消',
      streamStatus: 'cancelled',
    })
  })

  it('omits streamStatus for regular complete chunks', () => {
    const chunk = normalizeChunk({ type: 'complete', content: 'done' })

    expect(chunk).toEqual({ type: 'complete', content: 'done' })
  })

  it('labels research_plan and export_pdf tools', () => {
    expect(describeTool('research_plan')).toBe('研究计划')
    expect(describeTool('export_pdf')).toBe('PDF 导出')
  })
})
