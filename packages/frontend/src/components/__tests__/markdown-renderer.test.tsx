import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MarkdownRenderer } from '@/components/markdown-renderer'

describe('MarkdownRenderer', () => {
  it('prefers ReactMarkdown rendering for fenced code blocks even when html is provided', () => {
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
    expect(container.querySelector('.rs-terminal')).toBeTruthy()
    expect(container.textContent).toContain('hello')
    expect(container.textContent).toContain('world')
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
})
