import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MarkdownRenderer } from '@/components/markdown-renderer'

describe('MarkdownRenderer', () => {
  it('renders provided HTML directly even when fallback contains code blocks', () => {
    const fallback = [
      '下面是一个代码块：',
      '',
      '```python',
      'print(\"hello\")',
      'print(\"world\")',
      '```',
      '',
    ].join('\n')
    const { container } = render(
      <MarkdownRenderer
        html={'<p>worker html</p><pre class=\"md-pre\"><code>noop</code></pre>'}
        fallback={fallback}
      />,
    )
    // HTML 优先：直接渲染传入的 HTML
    expect(container.querySelector('.md-pre')).toBeTruthy()
    expect(container.textContent).toContain('worker html')
    expect(container.textContent).toContain('noop')
  })

  it('renders code blocks from worker code markers', () => {
    const payload = Buffer.from(JSON.stringify({ language: 'python', code: 'print(\"hi\")\\n' }), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '')
    const html = `<p>before</p><!--AICHAT_CODE_BLOCK:${payload}--><p>after</p>`
    const { container } = render(<MarkdownRenderer html={html} fallback="" />)
    expect(container.querySelector('.rs-terminal')).toBeTruthy()
    expect(container.textContent).toContain('before')
    expect(container.textContent).toContain('print(\"hi\")')
    expect(container.textContent).toContain('after')
  })

  it('keeps CJK text after a bare URL outside the link', () => {
    const { container } = render(
      <MarkdownRenderer html={null} fallback="访问 https://example.com后续正文" />,
    )
    const link = container.querySelector('a')

    expect(link?.getAttribute('href')).toBe('https://example.com')
    expect(link?.textContent).toBe('https://example.com')
    expect(container.textContent).toContain('后续正文')
  })

  it('renders an unfinished streaming fence as a markdown code block', () => {
    const fallback = ['```ts', 'const value = 1'].join('\n')
    const { container } = render(<MarkdownRenderer html="" fallback={fallback} isStreaming />)

    expect(container.querySelector('.rs-terminal')).toBeTruthy()
    expect(container.textContent).toContain('const value = 1')
  })
})
