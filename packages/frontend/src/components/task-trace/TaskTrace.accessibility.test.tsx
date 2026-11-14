import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TaskTraceFilters } from './TaskTraceFilters'
import { TaskTraceTable } from './TaskTraceTable'
import { TaskTraceDetailDialog } from './TaskTraceDetailDialog'
afterEach(cleanup)
describe('任务追踪键盘入口', () => {
  it('shows feedback instead of an empty failed detail dialog', () => {
    render(<TaskTraceDetailDialog open selected={{ id: 42 } as any} detail={null} detailLoading={false} detailTab="trace" onTabChange={vi.fn()} onClose={vi.fn()} onExportTrace={vi.fn()} onExportLatex={vi.fn()} onDeleteLatex={vi.fn()} onEnsureLatexEvents={vi.fn()} latexEvents={[]} latexTruncated={false} latexLoading={false} />)
    expect(screen.getByRole('status')).toHaveTextContent('详情未加载')
  })
  it('submits filters with Enter and names the status control', () => {
    const onSearch = vi.fn()
    render(<TaskTraceFilters sessionFilter="" keyword="" status="" onSessionFilterChange={vi.fn()} onKeywordChange={vi.fn()} onStatusChange={vi.fn()} onSearch={onSearch} onReset={vi.fn()} />)
    expect(screen.getByRole('combobox', { name: '状态' })).toBeInTheDocument()
    fireEvent.submit(screen.getByRole('search'))
    expect(onSearch).toHaveBeenCalledTimes(1)
  })
  it('opens trace details with a named button rather than a click-only row', () => {
    const onOpenDetail = vi.fn()
    const trace = { id: 42, sessionId: 1, actor: 'user:测试', status: 'error', startedAt: '2026-11-14T00:00:00Z', durationMs: 20, eventCount: 1 }
    render(<TaskTraceTable items={[trace as any]} loading={false} deletingId={null} onOpenDetail={onOpenDetail} onExport={vi.fn()} onDelete={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '查看追踪 #42' }))
    expect(onOpenDetail).toHaveBeenCalledTimes(1)
    expect(screen.getByText('失败').className).toContain('destructive')
  })
})
