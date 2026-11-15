import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ComposerActiveCapabilities } from '@/components/chat/composer-active-capabilities'
import { activeCapabilityItems } from './composer-tools-fixtures'

describe('ComposerActiveCapabilities — 点击直达能力', () => {
  it('每个已启用条目标签直接调用自己的 onActivate', () => {
    const onActivate = vi.fn()
    render(
      <ComposerActiveCapabilities
        items={activeCapabilityItems(['思考', '联网'], onActivate)}
        mobile={false}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '思考' }))
    expect(onActivate).toHaveBeenLastCalledWith(0, '思考')

    fireEvent.click(screen.getByRole('button', { name: '联网' }))
    expect(onActivate).toHaveBeenLastCalledWith(1, '联网')
  })

  it('标签带图标并保留可访问名', () => {
    render(<ComposerActiveCapabilities items={activeCapabilityItems(['思考'])} mobile={false} />)

    const chip = screen.getByRole('button', { name: '思考' })
    expect(chip.querySelector('[data-testid="cap-icon"]')).not.toBeNull()
  })
})

describe('ComposerActiveCapabilities — 溢出汇总', () => {
  it('手机最多两个可见条目，其余汇总为 +N 并打开面板', () => {
    const onOverflowActivate = vi.fn()
    render(
      <ComposerActiveCapabilities
        items={activeCapabilityItems(['思考', '联网', 'Python'])}
        mobile
        onOverflowActivate={onOverflowActivate}
      />,
    )

    expect(screen.getByRole('button', { name: '思考' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '联网' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Python' })).not.toBeInTheDocument()

    const overflow = screen.getByRole('button', { name: '还有 1 个已启用能力，打开工具面板' })
    expect(overflow.className).toContain('min-w-11')

    fireEvent.click(overflow)
    expect(onOverflowActivate).toHaveBeenCalledTimes(1)
    expect(screen.getByText('+1')).toBeInTheDocument()
  })

  it('桌面默认显示三个，超出部分同样汇总', () => {
    const onOverflowActivate = vi.fn()
    render(
      <ComposerActiveCapabilities
        items={activeCapabilityItems(['思考', '联网', '深度研究', 'Python'])}
        mobile={false}
        onOverflowActivate={onOverflowActivate}
      />,
    )

    for (const label of ['思考', '联网', '深度研究']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Python' })).not.toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
  })

  it('没有溢出时不渲染 +N', () => {
    render(<ComposerActiveCapabilities items={activeCapabilityItems(['思考', '联网'])} mobile />)

    expect(screen.queryByRole('button', { name: /还有 .* 个已启用能力/ })).not.toBeInTheDocument()
  })

  it('maxVisible 可由调用方收紧', () => {
    render(
      <ComposerActiveCapabilities
        items={activeCapabilityItems(['思考', '联网', 'Python'])}
        mobile={false}
        maxVisible={1}
        onOverflowActivate={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: '思考' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '联网' })).not.toBeInTheDocument()
    expect(screen.getByText('+2')).toBeInTheDocument()
  })
})

describe('ComposerActiveCapabilities — 空与禁用', () => {
  it('没有已启用能力时不渲染任何节点', () => {
    const { container } = render(<ComposerActiveCapabilities items={[]} mobile />)

    expect(container.innerHTML).toBe('')
  })

  it('禁用时标签与 +N 都不可点击', () => {
    render(
      <ComposerActiveCapabilities
        items={activeCapabilityItems(['思考', '联网', 'Python'])}
        mobile
        disabled
        onOverflowActivate={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: '思考' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /还有 1 个已启用能力/ })).toBeDisabled()
  })
})
