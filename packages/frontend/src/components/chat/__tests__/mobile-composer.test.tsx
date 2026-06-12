import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MobileComposer } from '@/components/chat/mobile-composer'

const createProps = (
  overrides: Partial<React.ComponentProps<typeof MobileComposer>> = {},
): React.ComponentProps<typeof MobileComposer> => ({
  input: '',
  textareaRef: { current: null },
  onInputChange: vi.fn(),
  onKeyDown: vi.fn(),
  onPaste: vi.fn(),
  onCompositionStart: vi.fn(),
  onCompositionEnd: vi.fn(),
  isStreaming: false,
  sendLocked: false,
  sendLockedReason: null,
  onSend: vi.fn(),
  onStop: vi.fn(),
  selectedImages: [],
  onRemoveImage: vi.fn(),
  thinkingEnabled: false,
  onToggleThinking: vi.fn(),
  effort: 'unset',
  onEffortChange: vi.fn(),
  webSearchEnabled: false,
  onToggleWebSearch: vi.fn(),
  webSearchScope: 'webpage',
  onWebSearchScopeChange: vi.fn(),
  showWebSearchScope: false,
  pickImages: vi.fn(),
  canUseWebSearch: true,
  webSearchDisabledNote: undefined,
  pythonToolEnabled: false,
  onTogglePythonTool: vi.fn(),
  canUsePythonTool: true,
  pythonToolDisabledNote: undefined,
  skillOptions: [],
  onToggleSkillOption: vi.fn(),
  isVisionEnabled: true,
  placeholder: '继续输入...',
  traceEnabled: false,
  canUseTrace: true,
  onToggleTrace: vi.fn(),
  onOpenAdvanced: vi.fn(),
  ...overrides,
})

describe('MobileComposer', () => {
  it('renders textarea and send button', () => {
    render(<MobileComposer {...createProps()} />)

    expect(screen.getByRole('textbox', { name: '输入消息' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument()
  })

  it('does not nest shell inside the mobile container', () => {
    render(<MobileComposer {...createProps()} />)

    // The mobile container (.md\\:hidden) should NOT contain a child with COMPOSER_SHELL_BASE_CLASS
    const mobileContainer = document.querySelector('.md\\:hidden')
    expect(mobileContainer).toBeInTheDocument()

    // COMPOSER_SHELL_BASE_CLASS uses rounded-[12px] — verify no child has it.
    // composerInnerEditorClass uses rounded-[10px] so [12px] uniquely identifies the shell.
    const shellInside = mobileContainer?.querySelector('.rounded-\\[12px\\]')
    expect(shellInside).toBeNull()
  })

  it('renders inner editor wrapper directly under mobile container', () => {
    render(<MobileComposer {...createProps()} />)

    const mobileContainer = document.querySelector('.md\\:hidden')
    expect(mobileContainer).toBeInTheDocument()

    // composerInnerEditorClass uses focus-within:ring-primary/10 — should be a direct or nested child
    const innerEditor = mobileContainer?.querySelector('.focus-within\\:ring-primary\\/10')
    expect(innerEditor).toBeInTheDocument()
  })
})
