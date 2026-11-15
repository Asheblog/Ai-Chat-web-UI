import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ChatToolbar } from '@/components/chat/chat-toolbar'

vi.mock('@/components/user-menu', () => ({ UserMenu: () => <button>账户菜单</button> }))

describe('desktop conversation toolbar', () => {
  it('reserves a separate header row for the conversation title and account control', () => {
    render(<ChatToolbar selectedModelId={null} onModelChange={() => {}} />)
    const header = screen.getByRole('banner', { name: '当前会话' })
    expect(header).toHaveClass('hidden', 'lg:flex', 'h-14', 'shrink-0')
    expect(header).not.toHaveClass('absolute')
    expect(header).toContainElement(screen.getByRole('button', { name: '账户菜单' }))
    expect(screen.getByRole('heading', { name: '聊天' })).toBeInTheDocument()
  })
  it('falls back to a readable title for an unnamed conversation', () => {
    render(<ChatToolbar title=" " selectedModelId={null} onModelChange={() => {}} />)
    expect(screen.getByRole('heading', { name: '聊天' })).toBeInTheDocument()
  })

  it('shows the current conversation title', () => {
    render(<ChatToolbar title="今日中国新闻 · 主题要点整理" selectedModelId={null} onModelChange={() => {}} />)
    expect(screen.getByRole('heading', { name: '今日中国新闻 · 主题要点整理' })).toBeInTheDocument()
  })
})
