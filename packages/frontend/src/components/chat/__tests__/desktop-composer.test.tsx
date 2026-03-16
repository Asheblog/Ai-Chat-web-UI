import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DesktopComposer } from '@/components/chat/desktop-composer'

const createProps = (overrides: Partial<React.ComponentProps<typeof DesktopComposer>> = {}): React.ComponentProps<typeof DesktopComposer> => ({
  input: 'hello',
  textareaRef: { current: null },
  onInputChange: vi.fn(),
  onKeyDown: vi.fn(),
  onPaste: vi.fn(),
  onCompositionStart: vi.fn(),
  onCompositionEnd: vi.fn(),
  placeholder: '输入消息',
  textareaDisabled: false,
  isStreaming: false,
  selectedImages: [],
  onRemoveImage: vi.fn(),
  pickImages: vi.fn(),
  isVisionEnabled: true,
  imageLimits: { maxCount: 4, maxMb: 10, maxEdge: 4096, maxTotalMb: 20 },
  thinkingEnabled: false,
  onToggleThinking: vi.fn(),
  webSearchEnabled: false,
  onToggleWebSearch: vi.fn(),
  webSearchScope: 'webpage',
  onWebSearchScopeChange: vi.fn(),
  showWebSearchScope: false,
  canUseWebSearch: true,
  webSearchDisabledNote: undefined,
  pythonToolEnabled: false,
  onTogglePythonTool: vi.fn(),
  canUsePythonTool: true,
  pythonToolDisabledNote: undefined,
  skillOptions: [],
  onToggleSkillOption: vi.fn(),
  traceEnabled: false,
  canUseTrace: true,
  onToggleTrace: vi.fn(),
  effort: 'unset',
  onEffortChange: vi.fn(),
  showExpand: false,
  onExpandOpen: vi.fn(),
  onOpenAdvanced: vi.fn(),
  onOpenSessionPrompt: vi.fn(),
  onSend: vi.fn(),
  onStop: vi.fn(),
  desktopSendDisabled: false,
  sendLockedReason: null,
  hasDocuments: false,
  pickDocuments: vi.fn(),
  onOpenAttachmentManager: vi.fn(),
  attachedDocumentsLength: 0,
  onOpenKnowledgeBase: vi.fn(),
  knowledgeBaseEnabled: true,
  knowledgeBaseCount: 0,
  ...overrides,
})

describe('DesktopComposer', () => {
  it('allows stopping while streaming even when send would otherwise be disabled', () => {
    const onStop = vi.fn()
    render(
      <DesktopComposer
        {...createProps({
          isStreaming: true,
          desktopSendDisabled: true,
          onStop,
        })}
      />,
    )

    const stopButton = screen.getByRole('button', { name: '停止生成' })
    expect(stopButton).not.toBeDisabled()

    fireEvent.click(stopButton)
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('keeps send button disabled when not streaming and send is locked', () => {
    render(
      <DesktopComposer
        {...createProps({
          isStreaming: false,
          desktopSendDisabled: true,
        })}
      />,
    )

    const sendButton = screen.getByRole('button', { name: '发送' })
    expect(sendButton).toBeDisabled()
  })
})
