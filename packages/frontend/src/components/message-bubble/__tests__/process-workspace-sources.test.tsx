import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CotTimeline } from '../cot-timeline'
import { completeCoverage, createMeta, summaryBar, toolEvent } from './process-fixtures'

/**
 * 来源页：去重后的清单 + 记录自带的主图。旧 tool-call-card 的"主图 · 共 N 张"迁到这里；
 * 没有来源证据时不产生空壳。
 */
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('来源页', () => {
  it('展示记录自带的来源主图与图片数', () => {
    render(
      <CotTimeline
        meta={createMeta()}
        reasoningRaw=""
        toolEvents={[toolEvent({
          id: 'img-1',
          callId: 'call-img-1',
          tool: 'read_url',
          details: {
            url: 'https://example.com/article',
            title: '示例文章',
            leadImageUrl: 'https://cdn.example.com/lead.png',
            images: [
              { url: 'https://cdn.example.com/lead.png' },
              { url: 'https://cdn.example.com/other.png' },
            ],
          },
        })]}
        coverage={completeCoverage}
      />,
    )

    fireEvent.click(summaryBar())
    fireEvent.click(screen.getByRole('tab', { name: '来源 1' }))

    expect(screen.getByAltText('示例文章')).toHaveAttribute('src', 'https://cdn.example.com/lead.png')
    expect(screen.getByText('主图 · 共 2 张')).toBeInTheDocument()
  })
})
