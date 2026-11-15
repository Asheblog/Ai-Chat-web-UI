import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MessageBubble } from '..'
import type { MessageBody, MessageMeta } from '@/types'

vi.mock('@/hooks/use-markdown-render', () => ({
  useMarkdownRender: () => ({ html: null, isRendering: false, errored: false }),
}))
vi.mock('../message-avatar', () => ({
  MessageAvatar: ({ alt }: { alt: string }) => <div role="img" aria-label={alt} />,
}))
vi.mock('../use-process-commands', () => ({ useProcessCommands: () => ({}) }))
vi.mock('@/features/chat/tool-events/useToolTimeline', () => ({
  useToolTimeline: ({ bodyEvents }: { bodyEvents: unknown[] }) => ({ timeline: bodyEvents ?? [] }),
}))

const meta: MessageMeta = { id: 'layout', stableKey: 'layout', sessionId: -1, role: 'assistant', createdAt: '2026-11-14T12:00:00Z' }
const body: MessageBody = { id: 'layout', stableKey: 'layout', content: '', reasoning: '正在分析资料', version: 1, reasoningVersion: 1 }

describe('message layout', () => {
  it('uses the process entry as the only running indicator', () => {
    const { container } = render(<MessageBubble meta={meta} body={body} isStreaming />)
    const entry = screen.getByRole('button', { name: /查看过程：进行中/ })
    expect(screen.getAllByText('进行中')).toHaveLength(1)
    expect(container.querySelectorAll('.animate-spin')).toHaveLength(1)
    expect(entry.querySelector('.animate-spin')).toBeInTheDocument()
    expect(screen.queryByText('AI 正在思考…')).toBeNull()
  })

  it('keeps the process entry above both streaming and completed answers', () => {
    const { rerender } = render(<MessageBubble meta={meta} body={{ ...body, content: '正文已经开始' }} isStreaming />)
    const expectProcessBeforeAnswer = () => {
      const entry = screen.getByRole('button', { name: /查看过程/ })
      expect(entry.compareDocumentPosition(screen.getByText('正文已经开始'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    }
    expectProcessBeforeAnswer()
    rerender(<MessageBubble meta={meta} body={{ ...body, content: '正文已经开始' }} />)
    expectProcessBeforeAnswer()
  })

  it('renders arriving answer text alongside the single progress entry', () => {
    const { rerender } = render(<MessageBubble meta={meta} body={body} isStreaming />)
    rerender(<MessageBubble meta={meta} body={{ ...body, content: '开始回答', version: 2 }} isStreaming />)
    expect(screen.queryByText(/AI ?正在思考/)).toBeNull()
    expect(screen.getByText('开始回答')).toBeInTheDocument()
  })

  it('keeps one progress entry before any records arrive and removes it when an empty run ends', () => {
    const { container, rerender } = render(<MessageBubble meta={meta} body={{ ...body, reasoning: '' }} isStreaming />)
    expect(screen.getByRole('button', { name: /查看过程：进行中/ })).toBeInTheDocument()
    expect(container.querySelectorAll('.animate-spin')).toHaveLength(1)
    expect(screen.queryByText('AI 正在思考…')).toBeNull()
    rerender(<MessageBubble meta={meta} body={{ ...body, reasoning: '' }} />)
    expect(screen.queryByRole('button', { name: /查看过程/ })).toBeNull()
    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  it('keeps image-only and rich responses visible while streaming', () => {
    const imageMeta: MessageMeta = { ...meta, generatedImages: [{ url: '/generated.png', revisedPrompt: '生成结果' }] }
    const { rerender } = render(<MessageBubble meta={imageMeta} body={body} isStreaming />)
    fireEvent.click(screen.getByRole('button', { name: '查看图片（1 张）' }))
    expect(screen.getByRole('img', { name: '生成结果' })).toBeInTheDocument()
    expect(screen.queryByText('AI 正在思考…')).toBeNull()
    rerender(<MessageBubble meta={{ ...meta, richPayload: { layout: 'auto', parts: [{ type: 'text', text: '富文本回答', format: 'markdown' }] } }} body={body} isStreaming />)
    expect(screen.getByText('富文本回答')).toBeInTheDocument()
    expect(screen.queryByText('AI 正在思考…')).toBeNull()
  })

  it('keeps one progress entry when generated image metadata has no usable image', () => {
    const { container } = render(<MessageBubble meta={{ ...meta, generatedImages: [{}] }} body={body} isStreaming />)
    expect(screen.getByRole('button', { name: /查看过程：进行中/ })).toBeInTheDocument()
    expect(container.querySelectorAll('.animate-spin')).toHaveLength(1)
    expect(screen.queryByText('AI 正在思考…')).toBeNull()
  })

  it('keeps the assistant avatar and omits the redundant user avatar', () => {
    const { rerender } = render(<MessageBubble meta={meta} body={body} />)
    expect(screen.getByRole('img', { name: 'AI 头像' })).toBeInTheDocument()
    const onShare = vi.fn()
    rerender(<MessageBubble meta={{ ...meta, id: 901, role: 'user' }} body={{ ...body, content: '用户提问' }} canEditUserMessage shareSelection={{ active: false, selectable: true, selected: false, onStart: onShare }} />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('用户提问')).toBeInTheDocument()
    expect(screen.getByTitle('复制消息')).toBeInTheDocument()
    expect(screen.getByTitle('编辑并重新发送')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('进入分享选择模式'))
    expect(onShare).toHaveBeenCalledOnce()
  })
})
