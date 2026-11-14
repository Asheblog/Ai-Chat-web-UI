import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ToolEvent } from '@/types'
import { ProcessReasoningSection } from '../views/reasoning-section'

const longText =
  '我需要先确认这个问题的具体范围包括时间范围、地域范围以及是否需要给出可引用的官方来源，然后再决定检索关键词。'
const firstText = '先确认时间范围，再找原始报道。'
const secondText = '价格页可能已更新，需要核对官方来源。'

const toolAt = (offset: number): ToolEvent => ({
  id: 'call-' + offset,
  callId: 'call-' + offset,
  sessionId: 5,
  messageId: 101,
  tool: 'web_search',
  stage: 'result',
  status: 'success',
  createdAt: Date.parse('2026-11-14T10:00:05Z'),
  updatedAt: Date.parse('2026-11-14T10:00:05Z'),
  query: '官方定价页',
  details: { reasoningOffsetStart: offset },
})

const reasoningButtons = () => screen.getAllByRole('button', { name: /深度思考/ })
const codepointLength = (value: string) => Array.from(value).length

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('推理摘要段落', () => {
  it('每段按钮显示该段内容摘要，不再重复固定标题与字数标签', () => {
    const reasoningRaw = `${firstText}\n\n${secondText}`
    render(
      <ProcessReasoningSection
        scopeKey="s:1"
        reasoningRaw={reasoningRaw}
        toolEvents={[toolAt(firstText.length + 2)]}
      />,
    )

    const buttons = reasoningButtons()
    expect(buttons).toHaveLength(2)

    const labels = buttons.map((button) => button.textContent?.trim() ?? '')
    expect(labels[0]).toBe('先确认时间范围，再找原始报道')
    expect(labels[1]).toBe('价格页可能已更新，需要核对官方来源')
    expect(labels[0]).not.toBe(labels[1])
    for (const button of buttons) {
      expect(button).not.toHaveTextContent('深度思考')
      expect(button.textContent ?? '').not.toMatch(/\d+\s*字/)
    }
  })

  it('超长段落摘要不超过 30 个码点，点击后展开该段全文', async () => {
    const user = userEvent.setup()
    render(<ProcessReasoningSection scopeKey="s:2" reasoningRaw={longText} toolEvents={[]} />)

    const button = reasoningButtons()[0]
    const summary = button.textContent?.trim() ?? ''
    expect(codepointLength(summary)).toBeLessThanOrEqual(30)
    expect(summary.endsWith('…')).toBe(true)
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(longText)).toBeNull()

    await user.click(button)

    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(longText)).toBeInTheDocument()
  })

  it('可访问名称保留“深度思考”上下文并带上摘要；仅展开时 aria-controls 指向正文', async () => {
    const user = userEvent.setup()
    render(<ProcessReasoningSection scopeKey="s:3" reasoningRaw={longText} toolEvents={[]} />)

    const button = reasoningButtons()[0]
    const summary = (button.textContent ?? '').trim()
    const name = button.getAttribute('aria-label') ?? button.textContent ?? ''
    expect(name).toContain('深度思考')
    expect(name).toContain(summary)

    // 折叠时正文没挂载，不输出指向不存在元素的 aria-controls
    expect(button).not.toHaveAttribute('aria-controls')

    await user.click(button)

    expect(button).toHaveAttribute('aria-expanded', 'true')
    const bodyId = button.getAttribute('aria-controls')
    expect(bodyId).toBeTruthy()
    const body = document.getElementById(bodyId ?? '')
    expect(body).not.toBeNull()
    expect(body?.textContent).toBe(longText)
  })

  it('展开偏好按 scopeKey + charStart 记住，重新挂载仍展开', async () => {
    const user = userEvent.setup()
    const view = render(
      <ProcessReasoningSection scopeKey="s:4" reasoningRaw={firstText} toolEvents={[]} />,
    )
    await user.click(reasoningButtons()[0])
    expect(reasoningButtons()[0]).toHaveAttribute('aria-expanded', 'true')
    expect(localStorage.getItem('aichat.cot_reasoning_visibility')).toContain('s:4:reasoning:0')

    view.unmount()
    render(<ProcessReasoningSection scopeKey="s:4" reasoningRaw={firstText} toolEvents={[]} />)
    expect(reasoningButtons()[0]).toHaveAttribute('aria-expanded', 'true')
  })

  it('纯代码段用首个代码行作标题，展开仍是完整原文', async () => {
    const user = userEvent.setup()
    const reasoningRaw = '```ts\nconst a = 1\n```'
    render(<ProcessReasoningSection scopeKey="s:6" reasoningRaw={reasoningRaw} toolEvents={[]} />)

    const button = reasoningButtons()[0]
    expect(button.textContent?.trim()).toBe('const a = 1')
    expect(button).not.toHaveTextContent('深度思考')

    await user.click(button)

    const body = document.getElementById(button.getAttribute('aria-controls') ?? '')
    expect(body).toHaveTextContent('const a = 1')
  })

  it('只有引导语时保留位置占位，不留空按钮', () => {
    render(<ProcessReasoningSection scopeKey="s:7" reasoningRaw="好的。" toolEvents={[]} />)

    const button = reasoningButtons()[0]
    expect(button.textContent?.trim()).toBe('第 1 段推理')
    expect(button).not.toHaveTextContent('深度思考')
  })

  it('没有推理时保留空态，不渲染摘要按钮', () => {
    render(<ProcessReasoningSection scopeKey="s:5" reasoningRaw="" toolEvents={[]} />)
    expect(screen.getByText('没有可展示的推理内容')).toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: /深度思考/ })).toHaveLength(0)
  })
})