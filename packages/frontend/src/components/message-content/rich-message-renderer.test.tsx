import { render, screen } from '@testing-library/react'
import { RichMessageRenderer } from './rich-message-renderer'

describe('RichMessageRenderer', () => {
  it('renders text-only payload', () => {
    render(
      <RichMessageRenderer
        payload={{
          layout: 'auto',
          parts: [{ type: 'text', text: '纯文本回答', format: 'markdown' }],
        }}
      />,
    )

    expect(screen.getByText('纯文本回答')).toBeInTheDocument()
  })

  it('ignores external web evidence images', () => {
    render(
      <RichMessageRenderer
        payload={{
          layout: 'side-by-side',
          parts: [
            { type: 'text', text: '今日要闻：\n1. 新闻 A', format: 'markdown' },
            {
              type: 'image',
              url: 'https://example.com/evidence-1.png',
              source: 'external',
              sourceKind: 'web',
              title: '证据图 1',
              sourceUrl: 'https://example.com/article-1',
            },
          ],
        }}
      />,
    )

    const root = screen.getByTestId('rich-message-renderer')
    expect(root).toHaveAttribute('data-render-mode', 'default')
    expect(root).toHaveAttribute('data-layout', 'auto')
    expect(screen.getByText('今日要闻：')).toBeInTheDocument()
    expect(screen.queryByText('证据图 1')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '查看原图' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '查看原文' })).not.toBeInTheDocument()
  })

  it('keeps side-by-side layout for non-web mixed payload', () => {
    render(
      <RichMessageRenderer
        payload={{
          layout: 'side-by-side',
          parts: [
            { type: 'text', text: '这是 AI 生图结果', format: 'markdown' },
            {
              type: 'image',
              url: 'https://example.com/generated-1.png',
              source: 'generated',
              sourceKind: 'generated',
            },
          ],
        }}
      />,
    )

    const root = screen.getByTestId('rich-message-renderer')
    expect(root).toHaveClass('lg:grid')
    expect(root).toHaveClass('lg:grid-cols-12')
    expect(root).toHaveAttribute('data-render-mode', 'default')
  })

  it('renders stack layout for image-only payload', () => {
    render(
      <RichMessageRenderer
        payload={{
          layout: 'stack',
          parts: [
            {
              type: 'image',
              url: 'https://example.com/generated-1.png',
              source: 'generated',
              sourceKind: 'generated',
            },
          ],
        }}
      />,
    )

    expect(screen.getByTestId('rich-message-renderer')).toHaveAttribute('data-layout', 'stack')
    expect(screen.getByAltText('证据图片 1')).toBeInTheDocument()
  })
})
