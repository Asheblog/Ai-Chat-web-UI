import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { CotTimeline } from '../cot-timeline'
import { completeCoverage, createMeta, openFirstRow, toolEvent, workspace } from './process-fixtures'

/**
 * 工具详情：原始输入、结果、命中来源、降级与截断证据全部按需展开。
 * 旧 tool-call-card 的详情能力迁到这里；没有来源证据时不伪造图片预览。
 */
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('调用详情（迁移自旧工具卡）', () => {
  it('按需呈现原始输入、结果与命中来源，没有来源证据时不伪造图片预览', () => {
    render(
      <CotTimeline
        meta={createMeta()}
        reasoningRaw=""
        toolEvents={[toolEvent({
          id: 'read-1',
          callId: 'call-read-1',
          tool: 'read_url',
          query: '官方定价页',
          argumentsText: '{"url":"https://example.com/pricing"}',
          resultText: '定价：每月 20 美元',
          hits: [{ title: '示例文章', url: 'https://example.com/article' }],
        })]}
        coverage={completeCoverage}
      />,
    )

    expect(screen.queryByText(/定价：每月 20 美元/)).toBeNull()
    openFirstRow()

    expect(screen.getByText(/"url":"https:\/\/example.com\/pricing"/)).toBeInTheDocument()
    expect(screen.getByText('定价：每月 20 美元')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /示例文章/ })).toHaveAttribute('href', 'https://example.com/article')
    expect(within(workspace()).queryByRole('img')).toBeNull()
  })

  it('长 JSON 结果只在展开后才挂载', () => {
    const longResult = JSON.stringify({ rows: Array.from({ length: 200 }, (_, index) => ({ index, note: '长结果' })) }, null, 2)
    render(
      <CotTimeline
        meta={createMeta()}
        reasoningRaw=""
        toolEvents={[toolEvent({ id: 'long-1', callId: 'call-long-1', tool: 'python_runner', resultText: longResult })]}
        coverage={completeCoverage}
      />,
    )

    expect(screen.queryByText(/"rows"/)).toBeNull()
    openFirstRow()
    expect(screen.getByText(/"rows"/)).toBeInTheDocument()
  })

  it('失败调用同时给出原始错误、回退目标与截断证据', () => {
    render(
      <CotTimeline
        meta={createMeta()}
        reasoningRaw=""
        toolEvents={[toolEvent({
          id: 'fail-1',
          callId: 'call-fail-1',
          tool: 'read_url',
          query: '来源二',
          stage: 'error',
          status: 'error',
          error: '来源二读取超时',
          resultText: undefined,
          details: { fallbackUsed: '搜索摘要', truncated: true },
        })]}
        coverage={completeCoverage}
      />,
    )

    openFirstRow()

    expect(screen.getByText('来源二读取超时')).toBeInTheDocument()
    expect(screen.getByText('降级为 搜索摘要')).toBeInTheDocument()
    expect(screen.getByText('结果被截断')).toBeInTheDocument()
    expect(screen.getByText('尝试与降级')).toBeInTheDocument()
  })
})
