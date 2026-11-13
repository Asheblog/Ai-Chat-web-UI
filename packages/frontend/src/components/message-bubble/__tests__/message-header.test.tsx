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

describe('MessageHeader — retired image transcription note', () => {
  it('never renders the transcription note, even when the legacy prop is wired', () => {
    // 退役的 imageDescriptionNote 仍可能被旧调用方传入；渲染层必须完全忽略。
    const legacyProps = {
      ...baseProps,
      isUser: true,
      timestamp: '2026-08-04',
      imageDescriptionNote: '图片描述由 qwen-vl-max 转写',
    } as unknown as React.ComponentProps<typeof MessageHeader>

    render(<MessageHeader {...legacyProps} />)

    expect(screen.queryByText(/转写/)).toBeNull()
    expect(screen.queryByTitle('图片由转写模型识别后供当前模型理解')).toBeNull()
  })
})
