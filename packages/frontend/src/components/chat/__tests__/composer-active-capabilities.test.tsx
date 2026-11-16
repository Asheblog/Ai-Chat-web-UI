import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComposerActiveCapabilities } from '@/components/chat/composer-active-capabilities'
import { activeCapabilityItems } from './composer-tools-fixtures'

let resize: (width: number) => void
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: (entries: { contentRect: { width: number } }[]) => void) {
      resize = (width) => callback([{ contentRect: { width } }])
    }
    observe() {}
    disconnect() {}
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('ComposerActiveCapabilities', () => {
  it('renders icons with accessible names and preserves activation', () => {
    const onActivate = vi.fn()
    render(<ComposerActiveCapabilities items={activeCapabilityItems(['思考', '联网'], onActivate)} />)
    const thinking = screen.getByRole('button', { name: '思考' })
    expect(thinking).toHaveTextContent('')
    expect(thinking.querySelector('[data-testid="cap-icon"]')).not.toBeNull()
    fireEvent.click(thinking)
    expect(onActivate).toHaveBeenLastCalledWith(0, '思考')
    fireEvent.click(screen.getByRole('button', { name: '联网' }))
    expect(onActivate).toHaveBeenLastCalledWith(1, '联网')
  })

  it('shows all fitting mobile icons, folds overflow and expands after resizing', () => {
    const onOverflowActivate = vi.fn()
    render(<ComposerActiveCapabilities items={activeCapabilityItems(['思考', '联网', 'Python'])} mobile onOverflowActivate={onOverflowActivate} />)
    act(() => resize(140))
    expect(screen.getByRole('button', { name: 'Python' })).toBeInTheDocument()
    act(() => resize(92))
    expect(screen.getByRole('button', { name: '思考' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '联网' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '还有 2 个已启用能力，打开工具面板' }))
    expect(onOverflowActivate).toHaveBeenCalledTimes(1)
    act(() => resize(140))
    expect(screen.getByRole('button', { name: 'Python' })).toBeInTheDocument()
    expect(screen.queryByText('+2')).not.toBeInTheDocument()
  })

  it('uses desktop button widths and reserves a slot for the exact hidden count', () => {
    render(<ComposerActiveCapabilities items={activeCapabilityItems(['思考', '联网', '深度研究', 'Python'])} />)
    act(() => resize(116))
    expect(screen.getByRole('button', { name: '联网' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '还有 2 个已启用能力，打开工具面板' })).toHaveTextContent('+2')
    act(() => resize(36))
    expect(screen.getByRole('button', { name: '还有 4 个已启用能力，打开工具面板' })).toHaveTextContent('+4')
  })

  it('renders nothing when no capabilities are enabled', () => {
    const { container } = render(<ComposerActiveCapabilities items={[]} mobile />)
    expect(container.innerHTML).toBe('')
  })

  it('disables visible icons and overflow while busy', () => {
    render(<ComposerActiveCapabilities items={activeCapabilityItems(['思考', '联网', 'Python'])} mobile disabled />)
    act(() => resize(92))
    expect(screen.getByRole('button', { name: '思考' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '还有 2 个已启用能力，打开工具面板' })).toBeDisabled()
  })
})
