import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ComposerToolsPanel } from '@/components/chat/composer-tools-panel'
import { toolsPanelProps } from './composer-tools-fixtures'

const installMatchMedia = (isDesktop: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('min-width: 768px') ? isDesktop : !isDesktop,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ComposerToolsPanel — 手机底部面板', () => {
  it('固定“能力 / 上下文与设置”两个页签并默认停在能力页', () => {
    render(<ComposerToolsPanel {...toolsPanelProps({ mobile: true, onOpenKnowledgeBase: vi.fn() })} />)

    expect(screen.getByRole('tab', { name: '能力' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '上下文与设置' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('switch', { name: '深度思考' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /知识库/ })).not.toBeInTheDocument()
  })

  it('切到上下文页签后只显示上下文项', () => {
    render(<ComposerToolsPanel {...toolsPanelProps({ mobile: true, onOpenKnowledgeBase: vi.fn() })} />)

    fireEvent.click(screen.getByRole('tab', { name: '上下文与设置' }))

    expect(screen.getByRole('tab', { name: '上下文与设置' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: /知识库/ })).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: '深度思考' })).not.toBeInTheDocument()
  })

  it('标题固定、内容滚动、底部“完成”关闭面板', () => {
    const onOpenChange = vi.fn()
    render(<ComposerToolsPanel {...toolsPanelProps({ mobile: true, onOpenChange })} />)

    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('工具')

    const scroller = dialog.querySelector('[data-composer-tools-scroll="true"]')
    expect(scroller).not.toBeNull()
    expect(scroller!.className).toContain('overflow-y-auto')

    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('底部完成与关闭按钮满足 44px 触控区，并保留安全区留白', () => {
    render(<ComposerToolsPanel {...toolsPanelProps({ mobile: true })} />)

    const done = screen.getByRole('button', { name: '完成' })
    expect(done.className).toContain('h-11')
    const close = screen.getByRole('button', { name: '关闭工具面板' })
    expect(close.className).toContain('h-11')
    expect(close.className).toContain('w-11')

    const dialog = screen.getByRole('dialog')
    expect(dialog.innerHTML).toContain('env(safe-area-inset-bottom)')
  })

  it('能力开关的真实命中区是整行 44px 按钮', () => {
    render(<ComposerToolsPanel {...toolsPanelProps({ mobile: true })} />)

    const row = screen.getByRole('switch', { name: '深度思考' })
    expect(row.tagName).toBe('BUTTON')
    expect(row.className).toContain('min-h-11')
    expect(row.className).toContain('w-full')
  })

  it('页签的 aria-controls 指向真实存在的 tabpanel', () => {
    render(<ComposerToolsPanel {...toolsPanelProps({ mobile: true, onOpenKnowledgeBase: vi.fn() })} />)

    for (const name of ['能力', '上下文与设置']) {
      const tab = screen.getByRole('tab', { name })
      const controls = tab.getAttribute('aria-controls')
      expect(controls).toBeTruthy()
      const panel = document.getElementById(controls!)
      expect(panel).not.toBeNull()
      expect(panel).toHaveAttribute('aria-labelledby', tab.getAttribute('id'))
    }

    fireEvent.click(screen.getByRole('tab', { name: '上下文与设置' }))
    const activeTab = screen.getByRole('tab', { name: '上下文与设置' })
    expect(activeTab).toHaveAttribute('aria-selected', 'true')
    expect(document.getElementById(activeTab.getAttribute('aria-controls')!)).not.toBeNull()
  })

  it('进入范围页时收起页签，返回与关闭固定在标题区', () => {
    render(
      <ComposerToolsPanel
        {...toolsPanelProps({
          mobile: true,
          webSearchEnabled: true,
          showWebSearchScope: true,
          onWebSearchScopeChange: vi.fn(),
        })}
      />,
    )

    const scroller = screen.getByRole('dialog').querySelector('[data-composer-tools-scroll="true"]')
    fireEvent.click(screen.getByRole('button', { name: /搜索范围/ }))

    expect(screen.queryByRole('tab', { name: '能力' })).not.toBeInTheDocument()
    expect(scroller!.contains(screen.getByRole('button', { name: '返回能力' }))).toBe(false)
    expect(scroller!.contains(screen.getByRole('button', { name: '关闭工具面板' }))).toBe(false)
  })

  it('手机进入范围页与返回后焦点明确', async () => {
    render(
      <ComposerToolsPanel
        {...toolsPanelProps({
          mobile: true,
          webSearchEnabled: true,
          showWebSearchScope: true,
          onWebSearchScopeChange: vi.fn(),
        })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /搜索范围/ }))
    const back = screen.getByRole('button', { name: '返回能力' })
    await waitFor(() => expect(document.activeElement).toBe(back))

    fireEvent.click(back)
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('tab', { name: '能力' })),
    )
  })

  it('手机端范围页可返回能力页', () => {
    render(
      <ComposerToolsPanel
        {...toolsPanelProps({
          mobile: true,
          webSearchEnabled: true,
          showWebSearchScope: true,
          onWebSearchScopeChange: vi.fn(),
        })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /搜索范围/ }))
    expect(screen.getByRole('radiogroup', { name: '搜索范围' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '返回能力' }))
    expect(screen.getByRole('switch', { name: '深度思考' })).toBeInTheDocument()
  })
})

describe('ComposerToolsPanel — 双端同时挂载', () => {
  it('桌面与手机实例的页签/面板 id 不冲突', () => {
    render(
      <>
        <ComposerToolsPanel {...toolsPanelProps({ open: true, mobile: true })} />
        <ComposerToolsPanel {...toolsPanelProps({ open: true, mobile: false })} />
      </>,
    )

    const ids = Array.from(document.querySelectorAll('[id]'))
      .map((node) => node.id)
      .filter((id) => id.startsWith('composer-tools'))
    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('ComposerToolsPanel — 视口与触发器', () => {
  it('未显式指定 mobile 时按 768px 断点选择形态', () => {
    installMatchMedia(false)
    const { unmount } = render(
      <ComposerToolsPanel {...toolsPanelProps({ mobile: undefined })} />,
    )
    expect(screen.getByRole('tab', { name: '能力' })).toBeInTheDocument()
    unmount()

    installMatchMedia(true)
    render(<ComposerToolsPanel {...toolsPanelProps({ mobile: undefined })} />)
    expect(screen.queryByRole('tab', { name: '能力' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭工具面板' })).toBeInTheDocument()
  })

  it('默认触发器是“工具”按钮，回传展开请求并暴露展开状态', () => {
    const onOpenChange = vi.fn()
    render(<ComposerToolsPanel {...toolsPanelProps({ open: false, onOpenChange, mobile: true })} />)

    const trigger = screen.getByRole('button', { name: '工具' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(trigger)
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })
})
