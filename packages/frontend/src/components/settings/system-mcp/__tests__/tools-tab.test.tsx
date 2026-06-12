import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ToolsTab } from '@/components/settings/system-mcp/tools-tab'

const mockSearchTools = vi.fn()
const mockGetToolDetail = vi.fn()
const mockPinTool = vi.fn()
const mockUnpinTool = vi.fn()

vi.mock('@/features/mcp/api', () => ({
  searchTools: (...args: any[]) => mockSearchTools(...args),
  getToolDetail: (...args: any[]) => mockGetToolDetail(...args),
  pinTool: (...args: any[]) => mockPinTool(...args),
  unpinTool: (...args: any[]) => mockUnpinTool(...args),
}))

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

describe('ToolsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('输入关键词点击搜索后调用 searchTools 并渲染结果', async () => {
    mockSearchTools.mockResolvedValue({
      data: [
        { connectionId: 1, originalName: 'my_tool', description: 'A useful tool', pinned: false },
        { connectionId: 1, originalName: 'another_tool', description: 'Another one', pinned: true },
      ],
    })

    render(<ToolsTab />)

    await act(async () => {
      const input = screen.getByPlaceholderText('搜索工具名...')
      fireEvent.change(input, { target: { value: 'tool' } })
    })

    await act(async () => {
      const searchBtn = screen.getByRole('button', { name: /搜索/ })
      fireEvent.click(searchBtn)
    })

    // Wait for the async search to complete and results to render
    await vi.waitFor(() => {
      expect(mockSearchTools).toHaveBeenCalledWith('tool')
    })
    await vi.waitFor(() => {
      expect(screen.getByText('my_tool')).toBeTruthy()
    })
    expect(screen.getByText('another_tool')).toBeTruthy()
  })

  it('空输入时按钮禁用', () => {
    render(<ToolsTab />)
    const searchBtn = screen.getByRole('button', { name: /搜索/ })
    expect(searchBtn).toBeDisabled()
  })
})
