import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownRenderer } from '../markdown-renderer'
import { renderMarkdownToHtml } from '@/lib/markdown-pipeline'

vi.mock('@/lib/markdown-pipeline', () => ({ renderMarkdownToHtml: vi.fn(() => ({ html: '<p>parsed</p>' })) }))

describe('MarkdownRenderer frame budget', () => {
  it('does not parse a large streaming fallback synchronously and keeps its tail readable', () => {
    const text = '中文长正文 '.repeat(4000) + 'VISIBLE END'
    const { container } = render(<MarkdownRenderer html={null} fallback={text} isStreaming isRendering />)
    expect(vi.mocked(renderMarkdownToHtml).mock.calls.length).toBe(0)
    expect(container.textContent).toContain('VISIBLE END')
  })
  it('preserves code block identity when surrounding HTML updates', () => {
    const encoded = Buffer.from(JSON.stringify({ code: 'value = 1', language: 'text' })).toString('base64url')
    const marker = '<!--AICHAT_CODE_BLOCK:' + encoded + '-->'
    const { container, rerender } = render(<MarkdownRenderer html={'<p>before</p>' + marker} fallback='' />)
    const block = container.querySelector('.rs-terminal')
    expect(block).not.toBeNull()
    const copy = block!.querySelector('button')!
    copy.focus()
    rerender(<MarkdownRenderer html={'<p>changed</p>' + marker} fallback='' />)
    expect(container.querySelector('.rs-terminal')).toBe(block)
    expect(document.activeElement).toBe(copy)
  })
  it('shows the managed worker failure without hiding the source', () => {
    const { container } = render(<MarkdownRenderer html={null} managed fallback='完整中文文本' errored />)
    expect(container.textContent).toContain('完整中文文本')
    expect(container.textContent).toContain('格式渲染暂不可用')
  })
  it('keeps unknown languages readable and escaped', async () => {
    const encoded = Buffer.from(JSON.stringify({ code: '<custom>中文</custom>', language: 'unknown-fixture' })).toString('base64url')
    const { container } = render(<MarkdownRenderer html={'<!--AICHAT_CODE_BLOCK:' + encoded + '-->'} fallback='' />)
    await waitFor(() => expect(container.querySelector('.rs-terminal code')).toHaveTextContent('<custom>中文</custom>'))
    expect(container.querySelector('custom')).toBeNull()
  })
})
