import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SkillPanelSheet } from '@/components/chat/skill-panel-sheet'
import { useState } from 'react'

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('min-width: 768px') ? true : false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  })),
})

describe('SkillPanelSheet MCP 区域', () => {
  it('全局关闭时显示禁用说明', () => {
    render(
      <SkillPanelSheet
        open={true}
        onOpenChange={vi.fn()}
        mcpGlobalEnabled={false}
        skillOptions={[]}
      />,
    )
    expect(screen.getByText(/管理员已关闭 MCP 全局开关/)).toBeTruthy()
  })

  it('加载状态显示骨架屏', () => {
    render(
      <SkillPanelSheet
        open={true}
        onOpenChange={vi.fn()}
        mcpGlobalEnabled={true}
        mcpLoading={true}
        skillOptions={[]}
      />,
    )
    // The MCP loading section should have text
    expect(screen.getByText('MCP 连接')).toBeTruthy()
  })

  it('错误状态显示错误信息', () => {
    render(
      <SkillPanelSheet
        open={true}
        onOpenChange={vi.fn()}
        mcpGlobalEnabled={true}
        mcpError="无法连接服务器"
        skillOptions={[]}
      />,
    )
    expect(screen.getByText(/无法连接服务器/)).toBeTruthy()
  })

  it('空状态显示提示', () => {
    render(
      <SkillPanelSheet
        open={true}
        onOpenChange={vi.fn()}
        mcpGlobalEnabled={true}
        mcpConnectionOptions={[]}
        skillOptions={[]}
      />,
    )
    expect(screen.getByText(/暂无可用 MCP 连接/)).toBeTruthy()
  })

  it('有连接时显示连接列表和开关', () => {
    const onToggle = vi.fn()
    render(
      <SkillPanelSheet
        open={true}
        onOpenChange={vi.fn()}
        mcpGlobalEnabled={true}
        mcpConnectionOptions={[
          { connectionId: 1, connectionName: 'My Server', installationLabel: 'my-mcp', enabled: true, bindingId: 10 },
          { connectionId: 2, connectionName: 'Another', installationLabel: 'another', enabled: false },
        ]}
        mcpSessionTools={[
          { id: 1, connectionId: 1, originalName: 'tool_a', pinned: true },
        ]}
        onToggleMcpBinding={onToggle}
        skillOptions={[]}
      />,
    )

    // Should show connection names
    expect(screen.getByText('My Server')).toBeTruthy()
    expect(screen.getByText('Another')).toBeTruthy()
    // Should show tool count
    expect(screen.getByText('1 个工具可用')).toBeTruthy()
  })

  it('开启连接时调用 onToggleMcpBinding', () => {
    const onToggle = vi.fn()
    render(
      <SkillPanelSheet
        open={true}
        onOpenChange={vi.fn()}
        mcpGlobalEnabled={true}
        mcpConnectionOptions={[
          { connectionId: 1, connectionName: 'Test', installationLabel: 'test', enabled: false },
        ]}
        onToggleMcpBinding={onToggle}
        skillOptions={[]}
      />,
    )

    // Find and click the switch
    const switches = screen.getAllByRole('switch')
    expect(switches.length).toBeGreaterThanOrEqual(1)
    fireEvent.click(switches[0])
    expect(onToggle).toHaveBeenCalledWith(1, true)
  })

  it('面板打开时调用 onActivate，且 onActivate 引用变化不会重复触发', () => {
    // 回归：欢迎页传入内联 onActivate（每次渲染新引用），
    // 若 effect 依赖 onActivate 会导致 setState→重渲染→再触发 的无限循环。
    const onActivate = vi.fn()
    let renderCount = 0

    function Harness() {
      const [, force] = useState(0)
      renderCount += 1
      return (
        <SkillPanelSheet
          open={true}
          onOpenChange={vi.fn()}
          skillOptions={[]}
          onActivate={() => {
            onActivate()
            // 模拟 load 完成后的 setState，触发一次重渲染
            force((n) => n + 1)
          }}
        />
      )
    }

    render(<Harness />)
    // 初始渲染触发一次 onActivate，随后的重渲染（force）不得再次触发
    expect(onActivate).toHaveBeenCalledTimes(1)
    // 组件在重渲染后保持稳定，不再进入 effect 循环
    expect(renderCount).toBeLessThan(5)
  })
})
