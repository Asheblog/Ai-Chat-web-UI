import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DetailDrawer, type BattleAttemptDetail } from './DetailDrawer'
vi.mock('@/components/markdown-renderer', () => ({ MarkdownRenderer: ({ fallback }: { fallback: string }) => <p>{fallback}</p> }))
const detail = (modelId: string): BattleAttemptDetail => ({
  isLive: true, modelId, modelKey: modelId, attemptIndex: 1, status: 'success',
  output: `${modelId} 的最终回答`, reasoning: `${modelId} 的推理摘要`,
})
beforeEach(() => localStorage.clear())
afterEach(cleanup)
describe('Battle process composition', () => {
  it('keeps the answer in one dialog and expands process inline on demand', () => {
    render(<DetailDrawer open onOpenChange={vi.fn()} detail={detail('模型A')} isRunning={false} runKey={9} />)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByText('模型A 的最终回答')).toBeVisible()
    expect(screen.queryByText('这轮做了什么')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /过程/ }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByText('这轮做了什么')).toBeVisible()
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: '停止后续工具' })).not.toBeInTheDocument()
  })
  it('does not carry another model process panel into the selected result', () => {
    const props = { open: true, onOpenChange: vi.fn(), isRunning: false, runKey: 9 }
    const { rerender } = render(<DetailDrawer {...props} detail={detail('模型A')} />)
    fireEvent.click(screen.getByRole('button', { name: /过程/ }))
    rerender(<DetailDrawer {...props} detail={detail('模型B')} />)
    expect(screen.getByText('模型B 的最终回答')).toBeVisible()
    expect(screen.queryByText('这轮做了什么')).not.toBeInTheDocument()
    expect(screen.queryByText('模型A 的推理摘要')).not.toBeInTheDocument()
  })
})
