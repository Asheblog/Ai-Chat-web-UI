import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ComposerToolsPanel } from '@/components/chat/composer-tools-panel'
import { toolsPanelProps } from './composer-tools-fixtures'

describe('ComposerToolsPanel — 能力行的真实触控目标', () => {
  it('Enter 切换一次，禁用时不触发', () => {
    const onToggleThinking = vi.fn()
    const { rerender } = render(<ComposerToolsPanel {...toolsPanelProps({ onToggleThinking })} />)
    fireEvent.keyDown(screen.getByRole('switch', { name: '深度思考' }), { key: 'Enter' })
    expect(onToggleThinking).toHaveBeenCalledTimes(1)
    rerender(<ComposerToolsPanel {...toolsPanelProps({ onToggleThinking, disabled: true })} />)
    fireEvent.keyDown(screen.getByRole('switch', { name: '深度思考' }), { key: 'Enter' })
    expect(onToggleThinking).toHaveBeenCalledTimes(1)
  })

  it('能力开关本身就是整行按钮，点标题即可切换', () => {
    const onToggleWebSearch = vi.fn()
    render(<ComposerToolsPanel {...toolsPanelProps({ onToggleWebSearch, mobile: true })} />)

    const row = screen.getByRole('switch', { name: '联网搜索' })
    expect(row.tagName).toBe('BUTTON')

    fireEvent.click(screen.getByText('检索最新网页内容'))
    expect(onToggleWebSearch).toHaveBeenCalledWith(true)
  })

  it('开关按钮本身达到 44px 且图标轨道只是装饰', () => {
    render(<ComposerToolsPanel {...toolsPanelProps({ mobile: true })} />)

    const row = screen.getByRole('switch', { name: '深度思考' })
    expect(row.className).toContain('min-h-11')
    expect(row.className).toContain('w-full')
    // 视觉轨道不进入无障碍树，也不承担点击。
    const track = row.querySelector('[data-slot="switch-track"]')
    expect(track).not.toBeNull()
    expect(track).toHaveAttribute('aria-hidden', 'true')
    expect(track!.tagName).toBe('SPAN')
  })

  it('任务追踪使用同样的整行开关', () => {
    const onToggleTrace = vi.fn()
    render(<ComposerToolsPanel {...toolsPanelProps({ canUseTrace: true, onToggleTrace })} />)

    const row = screen.getByRole('switch', { name: '任务追踪' })
    expect(row.tagName).toBe('BUTTON')
    expect(row.className).toContain('min-h-11')
    fireEvent.click(screen.getByText('任务追踪'))
    expect(onToggleTrace).toHaveBeenCalledWith(true)
  })
})

describe('ComposerToolsPanel — 受限原因', () => {
  it('联网不可用时禁用开关并显示受限原因', () => {
    const onToggleWebSearch = vi.fn()
    render(
      <ComposerToolsPanel
        {...toolsPanelProps({
          canUseWebSearch: false,
          webSearchDisabledNote: '当前模型不支持联网搜索',
          onToggleWebSearch,
        })}
      />,
    )

    const toggle = screen.getByRole('switch', { name: '联网搜索' })
    expect(toggle).toBeDisabled()
    expect(screen.getByText('当前模型不支持联网搜索')).toBeInTheDocument()

    fireEvent.click(toggle)
    expect(onToggleWebSearch).not.toHaveBeenCalled()
  })

  it('Python 不可用时禁用开关并显示受限原因', () => {
    render(
      <ComposerToolsPanel
        {...toolsPanelProps({ canUsePythonTool: false, pythonToolDisabledNote: '当前连接未开启 Python 运行时' })}
      />,
    )

    expect(screen.getByRole('switch', { name: 'Python' })).toBeDisabled()
    expect(screen.getByText('当前连接未开启 Python 运行时')).toBeInTheDocument()
  })

  it('可用时不显示受限原因', () => {
    render(<ComposerToolsPanel {...toolsPanelProps({ webSearchDisabledNote: '不该出现的原因' })} />)

    expect(screen.queryByText('不该出现的原因')).not.toBeInTheDocument()
  })
})
