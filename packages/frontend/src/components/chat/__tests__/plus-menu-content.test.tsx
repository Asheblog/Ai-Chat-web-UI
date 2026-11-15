import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PlusMenuContent } from '@/components/plus-menu-content'

describe('PlusMenuContent — 强度入口已移出工具菜单', () => {
  it('即使调用方继续传入 effort 也不再渲染强度控件', () => {
    render(
      <PlusMenuContent
        container="plain"
        effort="max"
        onEffortChange={vi.fn()}
        canUseTrace
        traceEnabled={false}
        onToggleTrace={vi.fn()}
      />,
    )

    expect(screen.queryByText('思考深度')).not.toBeInTheDocument()
    expect(screen.queryByText('思考强度')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('任务追踪等上下文开关仍可用', () => {
    const onToggleTrace = vi.fn()
    render(
      <PlusMenuContent
        container="plain"
        canUseTrace
        traceEnabled={false}
        onToggleTrace={onToggleTrace}
      />,
    )

    fireEvent.click(screen.getByRole('switch', { name: '任务追踪' }))
    expect(onToggleTrace).toHaveBeenCalledWith(true)
  })
})
