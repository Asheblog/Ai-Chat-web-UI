import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ToolCallCard } from '@/components/message-bubble/tool-call-card'
import type { ToolEvent } from '@/types'

const createEvent = (override: Partial<ToolEvent> = {}): ToolEvent => ({
  id: 'tool-1',
  sessionId: 1,
  messageId: 1,
  tool: 'read_url',
  stage: 'result',
  status: 'success',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  summary: '网页读取完成',
  details: {
    url: 'https://example.com/article',
    title: '示例文章',
    leadImageUrl: 'https://cdn.example.com/lead.png',
    images: [
      { url: 'https://cdn.example.com/lead.png' },
      { url: 'https://cdn.example.com/other.png' },
    ],
  },
  ...override,
})

describe('ToolCallCard', () => {
  it('renders read_url lead image preview', () => {
    render(<ToolCallCard event={createEvent()} />)

    expect(screen.getByAltText('示例文章')).toHaveAttribute('src', 'https://cdn.example.com/lead.png')
    expect(screen.getByText('主图 · 共 2 张')).toBeInTheDocument()
  })
})
