import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChatComposerPanel } from '@/components/chat/chat-composer-panel'

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
  pickImages: vi.fn(),
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
  fileInputRef: { current: null },
  onFilesSelected: vi.fn(),
  imageLimits: { maxCount: 4, maxMb: 10, maxEdge: 4096, maxTotalMb: 20 },
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
  workspaceFileInputRef: { current: null },
  workspaceFiles: [],
  isUploadingWorkspaceFiles: false,
  hasWorkspaceFiles: false,
  pickWorkspaceFiles: vi.fn(),
  onWorkspaceFilesSelected: vi.fn(),
  onRemoveWorkspaceFile: vi.fn(),
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
})
