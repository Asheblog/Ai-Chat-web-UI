import { describe, expect, it, afterEach } from 'vitest'
import { act, render } from '@testing-library/react'
import { VerticalLineScroller } from '@/components/message-bubble/vertical-line-scroller'

const getScroller = (container: HTMLElement) =>
  container.querySelector('[data-testid="cot-vertical-line-scroller"]')

describe('VerticalLineScroller', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('非活跃态直接停在最后一行', () => {
    const { container } = render(<VerticalLineScroller text={'第一行\n第二行\n第三行'} />)

    const scroller = getScroller(container)
    expect(scroller).toHaveAttribute('data-line-count', '3')
    expect(scroller).toHaveAttribute('data-line-index', '2')
    expect(scroller).toHaveAttribute('data-active', 'false')
  })

  it('活跃态逐行向下滚动，滚到当前最后一行后停住，输出结束后停在最后一行', () => {
    vi.useFakeTimers()
    const { container, rerender } = render(
      <VerticalLineScroller text={'第一行\n第二行\n第三行'} active />,
    )

    const scroller = () => getScroller(container)
    expect(scroller()).toHaveAttribute('data-line-index', '0')
    expect(scroller()).toHaveAttribute('data-active', 'true')

    act(() => {
      vi.advanceTimersByTime(1300)
    })
    expect(scroller()).toHaveAttribute('data-line-index', '1')

    act(() => {
      vi.advanceTimersByTime(1300)
    })
    expect(scroller()).toHaveAttribute('data-line-index', '2')

    // 滚到当前最后一行后停住等待新行，不循环
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(scroller()).toHaveAttribute('data-line-index', '2')

    rerender(<VerticalLineScroller text={'第一行\n第二行\n第三行'} />)
    expect(scroller()).toHaveAttribute('data-line-index', '2')
    expect(scroller()).toHaveAttribute('data-active', 'false')
  })

  it('流式快速追加新行时滚动计时器不重置，持续推进', () => {
    vi.useFakeTimers()
    const { container, rerender } = render(
      <VerticalLineScroller text={'第一行\n第二行'} active />,
    )

    const scroller = () => getScroller(container)
    expect(scroller()).toHaveAttribute('data-line-index', '0')

    act(() => {
      vi.advanceTimersByTime(600)
    })
    rerender(<VerticalLineScroller text={'第一行\n第二行\n第三行'} active />)

    // 追加新行不应重置计时器：再过 700ms 累计 1300ms，应滚到第 2 行
    act(() => {
      vi.advanceTimersByTime(700)
    })
    expect(scroller()).toHaveAttribute('data-line-index', '1')
  })
})
