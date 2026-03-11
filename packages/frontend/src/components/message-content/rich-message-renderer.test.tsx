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

  it('renders news list mode for web evidence and maps cards by order', () => {
    render(
      <RichMessageRenderer
        payload={{
          layout: 'side-by-side',
          parts: [
            { type: 'text', text: '今日要闻：\n1. 新闻 A\n2. 新闻 B', format: 'markdown' },
            {
              type: 'image',
              url: 'https://example.com/evidence-1.png',
              source: 'external',
              sourceKind: 'web',
              title: '证据图 1',
              sourceUrl: 'https://example.com/article-1',
              confidence: 'high',
              refId: 'img-1',
              meta: { evidenceOrder: 1 },
            },
            {
              type: 'image',
              url: 'https://example.com/evidence-2.png',
              source: 'external',
              sourceKind: 'web',
              title: '证据图 2',
              sourceUrl: 'https://example.com/article-2',
              confidence: 'high',
              refId: 'img-2',
              meta: { evidenceOrder: 2 },
            },
          ],
        }}
      />,
    )

    const root = screen.getByTestId('rich-message-renderer')
    expect(root).toHaveAttribute('data-render-mode', 'news-list')
    expect(root).not.toHaveClass('lg:grid-cols-12')
    expect(screen.getByTestId('news-item-1')).toBeInTheDocument()
    expect(screen.getByTestId('news-item-2')).toBeInTheDocument()
    const sourceLinks = screen.getAllByRole('link', { name: '查看原文' })
    expect(sourceLinks).toHaveLength(2)
    expect(sourceLinks[0]).toHaveAttribute('href', 'https://example.com/article-1')
    expect(sourceLinks[1]).toHaveAttribute('href', 'https://example.com/article-2')
  })

  it('hides source link when source url is invalid', () => {
    render(
      <RichMessageRenderer
        payload={{
          layout: 'stack',
          parts: [
            {
              type: 'image',
              url: 'https://example.com/evidence-1.png',
              source: 'external',
              sourceKind: 'web',
              sourceUrl: 'https://example.com/evidence-1.png',
            },
          ],
        }}
      />,
    )

    expect(screen.getByRole('link', { name: '查看原图' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '查看原文' })).not.toBeInTheDocument()
  })

  it('falls back to bottom source cards when markdown is not a list', () => {
    render(
      <RichMessageRenderer
        payload={{
          layout: 'side-by-side',
          parts: [
            { type: 'text', text: '这是一段普通段落，不是列表结构。', format: 'markdown' },
            {
              type: 'image',
              url: 'https://example.com/evidence-1.png',
              source: 'external',
              sourceKind: 'web',
              sourceUrl: 'https://example.com/article-1',
            },
          ],
        }}
      />,
    )

    expect(screen.getByText('来源')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看原图' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看原文' })).toBeInTheDocument()
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
