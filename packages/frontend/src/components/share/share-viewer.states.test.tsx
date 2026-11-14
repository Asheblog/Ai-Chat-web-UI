import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ShareViewer } from './share-viewer'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const share = { id: 1, sessionId: 1, token: 'public', title: '公开对话 / 很长的标题'.repeat(8), sessionTitle: '对话', messageCount: 2, createdAt: '2026-11-14T00:00:00.000Z', expiresAt: null, revokedAt: null, messages: [] }
const renderShare = () => render(<ShareViewer share={share} token="public" initialMessages={[]} initialPagination={{ page: 1, limit: 1, total: 2, totalPages: 2 }} />)

describe('公开分享状态', () => {
  it('keeps the public page read-only and exposes the real app entry', () => {
    renderShare()
    expect(screen.getByRole('link', { name: '打开 AIChat' })).toHaveAttribute('href', '/main')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).className).toContain('break-words')
  })
  it('reports pagination failure and retries the same page without losing content', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: { messages: [], pagination: { page: 2, limit: 1, total: 2, totalPages: 2 } } }) })
    vi.stubGlobal('fetch', fetchMock)
    renderShare()
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('消息加载失败，请重试')
    fireEvent.click(screen.getByRole('button', { name: '重试加载' }))
    await screen.findByText('分享中暂无可展示的内容')
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/shares/public/messages?page=2&limit=1', expect.anything())
  })
})
