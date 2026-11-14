import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CotTimeline } from '../cot-timeline'
import {
  completeCoverage,
  createMeta,
  longReasoning,
  openWorkspace,
  reasoningButtons,
} from './process-fixtures'

/**
 * 按需推理：只有用户展开那张卡才挂载原始文本，流式期间也不铺原文（不制造伪实时）。
 */
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('推理摘要按需挂载', () => {
  it('长推理只在展开单张卡后才挂载文本', () => {
    render(<CotTimeline meta={createMeta()} reasoningRaw={longReasoning} toolEvents={[]} coverage={completeCoverage} />)

    openWorkspace()
    expect(screen.queryByText(/推理第0行/)).toBeNull()

    fireEvent.click(reasoningButtons()[0])
    expect(screen.getByText(/推理第0行/)).toBeInTheDocument()
    expect(screen.getByText(/推理第399行/)).toBeInTheDocument()
  })

  it('流式超长推理只给一行摘要，不挂载原始文本', () => {
    render(
      <CotTimeline
        meta={createMeta({ reasoningStatus: 'streaming' })}
        reasoningRaw={longReasoning}
        toolEvents={[]}
        isStreaming
        coverage={completeCoverage}
      />,
    )

    expect(screen.getByText('进行中')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText(/推理第0行/)).toBeNull()
  })
})
