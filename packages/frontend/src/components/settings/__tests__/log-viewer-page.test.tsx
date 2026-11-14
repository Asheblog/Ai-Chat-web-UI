import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LogViewerPage } from '../pages/LogViewerPage'
vi.mock('../pages/SystemLogsPage', () => ({ SystemLogsPage: () => <div>运行日志内容</div> }))
vi.mock('@/components/task-trace/TaskTraceConsole', () => ({ TaskTraceConsole: () => <div>任务追踪内容</div> }))
afterEach(cleanup)
it('日志使用两项真实标签页、唯一页标题及键盘切换', () => {
 render(<LogViewerPage />)
 expect(screen.getByRole('heading', { level: 1, name: '日志与追踪' })).toBeInTheDocument()
 const first=screen.getByRole('tab', { name: '运行日志' }); const second=screen.getByRole('tab', { name: '任务追踪' })
 expect(first).toHaveAttribute('aria-selected','true')
 expect(screen.getByRole('tabpanel')).toHaveTextContent('运行日志内容')
 fireEvent.keyDown(first,{key:'ArrowRight'})
 expect(second).toHaveAttribute('aria-selected','true')
 expect(second).toHaveFocus()
 expect(screen.getByRole('tabpanel')).toHaveTextContent('任务追踪内容')
 expect(screen.queryByText('运行日志内容')).not.toBeInTheDocument()
})
