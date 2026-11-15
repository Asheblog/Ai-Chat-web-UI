import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ComposerToolsPanel } from '@/components/chat/composer-tools-panel'
import { toolsPanelProps } from './composer-tools-fixtures'

describe('ComposerToolsPanel — 能力开关回传现有回调', () => {
  it('逐个能力开关只调用对应的既有回调', () => {
    const onToggleThinking = vi.fn()
    const onToggleWebSearch = vi.fn()
    const onToggleDeepResearch = vi.fn()
    const onTogglePythonTool = vi.fn()

    render(
      <ComposerToolsPanel
        {...toolsPanelProps({ onToggleThinking, onToggleWebSearch, onToggleDeepResearch, onTogglePythonTool })}
      />,
    )

    fireEvent.click(screen.getByRole('switch', { name: '深度思考' }))
    expect(onToggleThinking).toHaveBeenCalledWith(true)

    fireEvent.click(screen.getByRole('switch', { name: '联网搜索' }))
    expect(onToggleWebSearch).toHaveBeenCalledWith(true)

    fireEvent.click(screen.getByRole('switch', { name: '深度研究' }))
    expect(onToggleDeepResearch).toHaveBeenCalledWith(true)

    fireEvent.click(screen.getByRole('switch', { name: 'Python' }))
    expect(onTogglePythonTool).toHaveBeenCalledWith(true)
  })

  it('已启用状态由上层值决定，关闭时回传 false', () => {
    const onToggleThinking = vi.fn()
    render(<ComposerToolsPanel {...toolsPanelProps({ thinkingEnabled: true, onToggleThinking })} />)

    const toggle = screen.getByRole('switch', { name: '深度思考' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(toggle)
    expect(onToggleThinking).toHaveBeenCalledWith(false)
  })

  it('编辑锁定或生成中时全部能力开关禁用', () => {
    render(<ComposerToolsPanel {...toolsPanelProps({ disabled: true })} />)

    for (const name of ['深度思考', '联网搜索', '深度研究', 'Python']) {
      expect(screen.getByRole('switch', { name })).toBeDisabled()
    }
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

describe('ComposerToolsPanel — 上下文与设置入口', () => {
  it('知识库入口回传既有动作并显示已选数量', () => {
    const onOpenKnowledgeBase = vi.fn()
    render(
      <ComposerToolsPanel
        {...toolsPanelProps({
          knowledgeBaseEnabled: true,
          knowledgeBaseCount: 2,
          onOpenKnowledgeBase,
        })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /知识库/ }))
    expect(onOpenKnowledgeBase).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/已选 2 个/)).toBeInTheDocument()
  })

  it('知识库未启用时入口禁用', () => {
    render(
      <ComposerToolsPanel
        {...toolsPanelProps({ knowledgeBaseEnabled: false, onOpenKnowledgeBase: vi.fn() })}
      />,
    )

    expect(screen.getByRole('button', { name: /知识库/ })).toBeDisabled()
  })

  it('第三方技能与 MCP 复用既有入口回调', () => {
    const onOpenSkillPanel = vi.fn()
    render(
      <ComposerToolsPanel {...toolsPanelProps({ onOpenSkillPanel, skillCount: 3 })} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /第三方技能与 MCP/ }))
    expect(onOpenSkillPanel).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/3 个已启用/)).toBeInTheDocument()
  })

  it('会话系统提示词与自定义请求头各自回传既有动作', () => {
    const onOpenSessionPrompt = vi.fn()
    const onOpenAdvanced = vi.fn()
    render(
      <ComposerToolsPanel {...toolsPanelProps({ onOpenSessionPrompt, onOpenAdvanced })} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /会话系统提示词/ }))
    expect(onOpenSessionPrompt).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /自定义请求头/ }))
    expect(onOpenAdvanced).toHaveBeenCalledTimes(1)
  })

  it('缺少动作的上下文入口禁用，不渲染空壳行', () => {
    render(<ComposerToolsPanel {...toolsPanelProps()} />)

    expect(screen.queryByRole('button', { name: /第三方技能与 MCP/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /会话系统提示词/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /知识库/ })).toBeDisabled()
  })

  it('任务追踪只在有权限且有回调时出现并可切换', () => {
    const onToggleTrace = vi.fn()
    const { rerender } = render(
      <ComposerToolsPanel {...toolsPanelProps({ canUseTrace: false, onToggleTrace })} />,
    )
    expect(screen.queryByRole('switch', { name: '任务追踪' })).not.toBeInTheDocument()

    rerender(<ComposerToolsPanel {...toolsPanelProps({ canUseTrace: true, onToggleTrace })} />)
    fireEvent.click(screen.getByRole('switch', { name: '任务追踪' }))
    expect(onToggleTrace).toHaveBeenCalledWith(true)
  })
})

describe('ComposerToolsPanel — 联网范围沿用既有枚举', () => {
  it('联网启用后进入范围列表并提供全部既有取值', () => {
    const onWebSearchScopeChange = vi.fn()
    render(
      <ComposerToolsPanel
        {...toolsPanelProps({
          webSearchEnabled: true,
          canUseWebSearch: true,
          showWebSearchScope: true,
          webSearchScope: 'webpage',
          onWebSearchScopeChange,
        })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /搜索范围/ }))

    for (const [label, value] of [
      ['网页', 'webpage'],
      ['文档', 'document'],
      ['论文', 'paper'],
      ['图片', 'image'],
      ['视频', 'video'],
      ['播客', 'podcast'],
    ] as const) {
      expect(screen.getByRole('radio', { name: label })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('radio', { name: label }))
      expect(onWebSearchScopeChange).toHaveBeenLastCalledWith(value)
      fireEvent.click(screen.getByRole('button', { name: /搜索范围/ }))
    }
  })

  it('选择范围后回到能力列表', () => {
    const onWebSearchScopeChange = vi.fn()
    render(
      <ComposerToolsPanel
        {...toolsPanelProps({
          webSearchEnabled: true,
          showWebSearchScope: true,
          onWebSearchScopeChange,
        })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /搜索范围/ }))
    fireEvent.click(screen.getByRole('radio', { name: '论文' }))

    expect(onWebSearchScopeChange).toHaveBeenCalledWith('paper')
    expect(screen.getByRole('switch', { name: '深度思考' })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: '论文' })).not.toBeInTheDocument()
  })

  it('联网关闭或没有范围回调时不渲染范围入口', () => {
    const { rerender } = render(
      <ComposerToolsPanel
        {...toolsPanelProps({ webSearchEnabled: false, showWebSearchScope: true, onWebSearchScopeChange: vi.fn() })}
      />,
    )
    expect(screen.queryByRole('button', { name: /搜索范围/ })).not.toBeInTheDocument()

    rerender(
      <ComposerToolsPanel {...toolsPanelProps({ webSearchEnabled: true, showWebSearchScope: false, onWebSearchScopeChange: vi.fn() })} />,
    )
    expect(screen.queryByRole('button', { name: /搜索范围/ })).not.toBeInTheDocument()
  })

  it('受控视图让上层直达范围页（联网标签）', () => {
    render(
      <ComposerToolsPanel
        {...toolsPanelProps({
          webSearchEnabled: true,
          showWebSearchScope: true,
          onWebSearchScopeChange: vi.fn(),
          view: 'search-scope',
        })}
      />,
    )

    expect(screen.getByRole('radiogroup', { name: '搜索范围' })).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: '深度思考' })).not.toBeInTheDocument()
  })
})

describe('ComposerToolsPanel — 受控展开与强度入口唯一', () => {
  it('open 由上层控制，关闭按钮只回传 onOpenChange(false)', () => {
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <ComposerToolsPanel {...toolsPanelProps({ open: false, onOpenChange })} />,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: '深度思考' })).not.toBeInTheDocument()

    rerender(<ComposerToolsPanel {...toolsPanelProps({ open: true, onOpenChange })} />)
    fireEvent.click(screen.getByRole('button', { name: '关闭工具面板' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('打开时通知上层加载 Skill 与 MCP 数据', () => {
    const onActivate = vi.fn()
    const { rerender } = render(
      <ComposerToolsPanel {...toolsPanelProps({ open: false, onActivate })} />,
    )
    expect(onActivate).not.toHaveBeenCalled()

    rerender(<ComposerToolsPanel {...toolsPanelProps({ open: true, onActivate })} />)
    expect(onActivate).toHaveBeenCalledTimes(1)

    rerender(<ComposerToolsPanel {...toolsPanelProps({ open: true, onActivate })} />)
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('不承载重复的思考强度入口', () => {
    render(<ComposerToolsPanel {...toolsPanelProps()} />)

    expect(screen.queryByText(/思考强度/)).not.toBeInTheDocument()
    expect(screen.queryByText(/思考深度/)).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })
})
