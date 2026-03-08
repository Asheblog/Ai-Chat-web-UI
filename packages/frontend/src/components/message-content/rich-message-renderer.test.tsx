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

  it('renders side-by-side layout for mixed payload', () => {
    render(
      <RichMessageRenderer
        payload={{
          layout: 'side-by-side',
          parts: [
            { type: 'text', text: '这是结论 [图1]', format: 'markdown' },
            {
              type: 'image',
              url: 'https://example.com/evidence-1.png',
              source: 'external',
              sourceKind: 'web',
              title: '证据图 1',
              sourceUrl: 'https://example.com/article-1',
              confidence: 'high',
              refId: 'img-1',
            },
          ],
        }}
      />,
    )

    const root = screen.getByTestId('rich-message-renderer')
    expect(root).toHaveClass('lg:grid')
    expect(root).toHaveClass('lg:grid-cols-12')
    expect(screen.getByRole('link', { name: '查看原图' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '打开来源' })).toBeInTheDocument()
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
