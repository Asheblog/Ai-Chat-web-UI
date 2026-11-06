import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { ChatComposerPanel } from '@/components/chat/chat-composer-panel'
import { useTextareaAutoResize } from '@/hooks/use-textarea-auto-resize'

const createProps = (
  overrides: Partial<React.ComponentProps<typeof ChatComposerPanel>> = {},
): React.ComponentProps<typeof ChatComposerPanel> => ({
  input: '',
  textareaRef: { current: null },
  showExpand: false,
  isStreaming: false,
  sendLocked: false,
  sendLockedReason: null,
  selectedImages: [],
  thinkingEnabled: false,
  webSearchEnabled: false,
  webSearchScope: 'webpage',
  showWebSearchScope: false,
  canUseWebSearch: true,
  pythonToolEnabled: false,
  onTogglePythonTool: vi.fn(),
  canUsePythonTool: true,
  deepResearchEnabled: false,
  onToggleDeepResearch: vi.fn(),
  skillOptions: [],
  onToggleSkillOption: vi.fn(),
  isVisionEnabled: true,
  traceEnabled: false,
  canUseTrace: true,
  effort: 'unset',
  basePlaceholder: '输入消息',
  mobilePlaceholder: '输入消息',
  textareaDisabled: false,
  desktopSendDisabled: false,
  onRemoveImage: vi.fn(),
  onInputChange: vi.fn(),
  onKeyDown: vi.fn(),
  onPaste: vi.fn(),
  onCompositionStart: vi.fn(),
  onCompositionEnd: vi.fn(),
  onSend: vi.fn(),
  onStop: vi.fn(),
  onToggleThinking: vi.fn(),
  onToggleWebSearch: vi.fn(),
  onWebSearchScopeChange: vi.fn(),
  onToggleTrace: vi.fn(),
  onEffortChange: vi.fn(),
  attachmentInputRef: { current: null },
  pickAttachments: vi.fn(),
  onAttachmentsSelected: vi.fn(),
  workspaceFiles: [],
  isUploadingWorkspaceFiles: false,
  hasWorkspaceFiles: false,
  onRemoveWorkspaceFile: vi.fn(),
  customHeaders: [],
  onAddCustomHeader: vi.fn(),
  onCustomHeaderChange: vi.fn(),
  onRemoveCustomHeader: vi.fn(),
  canAddCustomHeader: true,
  customBody: '',
  onCustomBodyChange: vi.fn(),
  sessionPromptDraft: '',
  sessionPromptSaving: false,
  sessionPromptSourceLabel: '',
  sessionPromptPlaceholder: '',
  onSessionPromptChange: vi.fn(),
  onSessionPromptSave: vi.fn(),
  ...overrides,
})

describe('ChatComposerPanel — send button disabled with only error workspace files', () => {
  it('disables send buttons when input is empty and all workspace files are error status', () => {
    render(
      <ChatComposerPanel
        {...createProps({
          input: '',
          selectedImages: [],
          workspaceFiles: [
            {
              localId: 'e1',
              filename: '',
              originalName: 'failed.xlsx',
              mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              fileSize: 20480,
              workspacePath: '',
              status: 'error',
              errorMessage: '413 文件过大',
            },
          ],
          hasWorkspaceFiles: true,
          desktopSendDisabled: true,
        })}
      />,
    )

    // Both mobile and desktop send buttons should be disabled
    const sendButtons = screen.getAllByRole('button', { name: '发送' })
    expect(sendButtons.length).toBeGreaterThanOrEqual(1)
    for (const btn of sendButtons) {
      expect(btn).toBeDisabled()
    }
  })

  it('enables send buttons when there is at least one ready workspace file', () => {
    render(
      <ChatComposerPanel
        {...createProps({
          input: '',
          selectedImages: [],
          workspaceFiles: [
            {
              localId: 'r1',
              filename: 'srv-report.pdf',
              originalName: 'report.pdf',
              mimeType: 'application/pdf',
              fileSize: 1024,
              workspacePath: 'input/srv-report.pdf',
              status: 'ready',
            },
          ],
          hasWorkspaceFiles: true,
        })}
      />,
    )

    const sendButtons = screen.getAllByRole('button', { name: '发送' })
    expect(sendButtons.length).toBeGreaterThanOrEqual(1)
    for (const btn of sendButtons) {
      expect(btn).not.toBeDisabled()
    }
  })

  it('renders vision proxy hint when proxy props are wired through panel', () => {
    render(
      <ChatComposerPanel
        {...createProps({
          selectedImages: [{ dataUrl: 'data:image/png;base64,abc', mime: 'image/png', size: 1024 }],
          isVisionEnabled: false,
          visionProxyEnabled: true,
          visionProxyModelId: 'qwen-vl-max',
        })}
      />,
    )

    // mobile 与 desktop 两处 composer 均渲染附件列表，提示条应出现
    expect(screen.getAllByText(/图片将由 qwen-vl-max 转写/).length).toBeGreaterThan(0)
  })

  it('gives the shared textarea ref to the visible composer only', () => {
    const textareaRef = { current: null as HTMLTextAreaElement | null }
    const { container, rerender } = render(
      <ChatComposerPanel
        {...createProps({ textareaRef, isDesktopComposer: false })}
      />,
    )

    const mobileTextarea = container.querySelector('.md\\:hidden textarea') as HTMLTextAreaElement
    const desktopTextarea = container.querySelector('.hidden.md\\:block textarea') as HTMLTextAreaElement
    expect(mobileTextarea).not.toBeNull()
    expect(desktopTextarea).not.toBeNull()
    // 两端始终挂载，仅靠 CSS 断点切换；被隐藏的一方不能写共享 ref。
    expect(mobileTextarea.closest('.md\\:hidden')).not.toBeNull()
    expect(desktopTextarea.closest('.hidden.md\\:block')).not.toBeNull()
    expect(mobileTextarea).not.toBe(desktopTextarea)
    expect(textareaRef.current).toBe(mobileTextarea)
    textareaRef.current?.focus()
    expect(document.activeElement).toBe(mobileTextarea)

    rerender(<ChatComposerPanel {...createProps({ textareaRef, isDesktopComposer: true })} />)
    expect(textareaRef.current).toBe(desktopTextarea)

    // 切回移动端时，桌面节点的解绑不能清空刚挂上的移动节点。
    rerender(<ChatComposerPanel {...createProps({ textareaRef, isDesktopComposer: false })} />)
    expect(textareaRef.current).toBe(mobileTextarea)
  })
})

const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')

function installMirrorScrollHeight() {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      if (this.getAttribute('data-composer-textarea-mirror') === 'true') {
        const raw = (this as HTMLTextAreaElement).value ?? ''
        if (!raw) return 0
        return raw.split('\n').length * 20
      }
      return 0
    },
  })
}

function DualComposerHarness({ isDesktopComposer }: { isDesktopComposer: boolean }) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const value = Array.from({ length: 9 }, (_, index) => `第${index + 1}行中文`).join('\n')
  useTextareaAutoResize(textareaRef, value, 200, isDesktopComposer)
  return (
    <ChatComposerPanel
      {...createProps({ input: value, textareaRef, isDesktopComposer })}
    />
  )
}

describe('ChatComposerPanel — dual composer textarea measurement', () => {
  beforeAll(installMirrorScrollHeight)
  afterAll(() => {
    if (originalScrollHeight) {
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight)
    }
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('grows the visible mobile textarea past its min height with 9 lines while desktop is hidden', async () => {
    const { container } = render(<DualComposerHarness isDesktopComposer={false} />)
    const mobileTextarea = container.querySelector('.md\\:hidden textarea') as HTMLTextAreaElement
    const desktopTextarea = container.querySelector('.hidden.md\\:block textarea') as HTMLTextAreaElement

    await waitFor(() => expect(mobileTextarea.style.height).toBe('180px'))
    expect(desktopTextarea.style.height).toBe('')
  })

  it('moves measurement to desktop after the breakpoint flips and back to mobile', async () => {
    const { container, rerender } = render(<DualComposerHarness isDesktopComposer={false} />)
    const mobileTextarea = container.querySelector('.md\\:hidden textarea') as HTMLTextAreaElement
    const desktopTextarea = container.querySelector('.hidden.md\\:block textarea') as HTMLTextAreaElement

    await waitFor(() => expect(mobileTextarea.style.height).toBe('180px'))
    expect(desktopTextarea.style.height).toBe('')

    rerender(<DualComposerHarness isDesktopComposer />)
    await waitFor(() => expect(desktopTextarea.style.height).toBe('180px'))

    rerender(<DualComposerHarness isDesktopComposer={false} />)
    await waitFor(() => expect(mobileTextarea.style.height).toBe('180px'))
  })
})
