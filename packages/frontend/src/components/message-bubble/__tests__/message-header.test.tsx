import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessageHeader } from '@/components/message-bubble/message-header'

const baseProps = {
  isUser: false,
  timestamp: '20:47',
  isCopied: false,
  onCopy: vi.fn(),
  shareEntryAvailable: false,
  showVariantControls: false,
  showVariantNavigation: false,
  isStreaming: false,
}

describe('MessageHeader metrics', () => {
  it('显示响应总耗时而不是首 token 延迟', () => {
    render(
      <MessageHeader
        {...baseProps}
        metrics={{
          durationMs: 1_101_000,
          speedText: '2.2',
        }}
      />,
    )

    expect(screen.getByText('18m21s')).toBeInTheDocument()
    expect(screen.getByText('2.2 tokens/s')).toBeInTheDocument()
  })
})
