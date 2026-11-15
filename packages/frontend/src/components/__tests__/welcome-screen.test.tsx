import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { WelcomeScreen } from '@/components/welcome-screen'
import type { WorkspaceFile } from '@/features/chat/composer'

const mockSubmit = vi.fn()
const mockTextareaChange = vi.fn()
const mockPickImages = vi.fn()
let isMobileViewport = false

const setViewport = (mobile: boolean) => {
  isMobileViewport = mobile
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => {
      const matches = query.includes('max-width: 767px')
        ? mobile
        : query.includes('min-width: 768px')
          ? !mobile
          : false
      return {
        matches,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }
    }),
  })
}

const createMockViewModel = () => ({
  header: {
    selectedModelId: 'model-a',
    onModelChange: vi.fn(),
    disabled: false,
    isCreating: false,
  },
  hero: {
    quotaExhausted: false,
    brandText: 'AIChat',
  },
  form: {
    query: '',
    isComposing: false,
    setIsComposing: vi.fn(),
    textareaRef: { current: null },
    basePlaceholder: '测试占位符',
    mobilePlaceholder: '输入消息...',
    mobileQuotaNotice: null as string | null,
    creationDisabled: false,
    isCreating: false,
    showExpand: false,
    onTextareaChange: mockTextareaChange,
    onKeyDown: vi.fn(),
    onSubmit: mockSubmit,
    onOpenExpand: vi.fn(),
    expand: {
      open: false,
      draft: '',
      onChange: vi.fn(),
      onClose: vi.fn(),
      onApply: vi.fn(),
    },
    attachments: {
      selectedImages: [],
      onRemoveImage: vi.fn(),
      onAttachmentsSelected: vi.fn(),
      pickAttachments: mockPickImages,
      onPaste: vi.fn(),
      workspaceFiles: [] as WorkspaceFile[],
      onRemoveWorkspaceFile: vi.fn(),
      attachmentInputRef: { current: null },
    },
    knowledgeBase: {
      enabled: false,
      availableKbs: [],
      selectedKbIds: [],
      isLoading: false,
      error: null,
      onToggle: vi.fn(),
      onSelectAll: vi.fn(),
      onClearAll: vi.fn(),
      onRefresh: vi.fn(),
      selectorOpen: false,
      onOpenSelector: vi.fn(),
      onSelectorOpenChange: vi.fn(),
    },
    advancedOptions: {
      disabled: false,
      thinkingEnabled: false,
      onToggleThinking: vi.fn(),
      effort: 'unset',
      onEffortChange: vi.fn(),
      webSearchEnabled: false,
      onToggleWebSearch: vi.fn(),
      canUseWebSearch: true,
      showWebSearchScope: false,
      webSearchScope: 'webpage',
      onWebSearchScopeChange: vi.fn(),
      webSearchDisabledNote: undefined,
      pythonToolEnabled: false,
      onTogglePythonTool: vi.fn(),
      canUsePythonTool: true,
      pythonToolDisabledNote: undefined,
      deepResearchEnabled: false,
      onToggleDeepResearch: vi.fn(),
      skillOptions: [],
      onToggleSkillOption: vi.fn(),
      onOpenAdvanced: vi.fn(),
      onOpenSessionPrompt: vi.fn(),
    },
    advancedDialog: {
      open: false,
      onClose: vi.fn(),
      customHeaders: [],
      onAddHeader: vi.fn(),
      onHeaderChange: vi.fn(),
      onRemoveHeader: vi.fn(),
      canAddHeader: true,
      customBodyInput: '',
      onCustomBodyChange: vi.fn(),
      customBodyError: null,
    },
    sessionPromptDialog: {
      open: false,
      value: '',
      onChange: vi.fn(),
      onClose: vi.fn(),
      onConfirm: vi.fn(),
      onClear: vi.fn(),
      placeholder: '提示词',
    },
  },
  footerNote: 'footer note',
})

let mockViewModel = createMockViewModel()

vi.mock('@/components/model-selector', () => ({
  // 本文件只验证欢迎页组合关系，模型选择器本体由其自身测试覆盖；桩保留真实可访问名。
  ModelSelector: ({ selectedModelId, onModelChange, disabled }: any) => (
    <>
      <button
        type="button"
        role="combobox"
        aria-label="选择模型"
        aria-expanded={false}
        aria-controls="welcome-model-stub-list"
        disabled={disabled}
        data-testid="model-selector"
        onClick={() => onModelChange({ id: 'model-b' })}
      >
        {selectedModelId || '选择模型'}
      </button>
      <span id="welcome-model-stub-list" hidden />
    </>
  ),
  formatModelShortName: (name: string) => name,
}))

vi.mock('@/components/user-menu', () => ({
  UserMenu: () => <div data-testid="user-menu">user</div>,
}))

vi.mock('@/components/chat/custom-request-editor', () => ({
  CustomRequestEditor: () => <div>custom-editor</div>,
}))

vi.mock('@/features/chat/welcome/useWelcomeScreenViewModel', () => ({
  useWelcomeScreenViewModel: vi.fn(() => mockViewModel),
}))

describe('WelcomeScreen', () => {
  beforeEach(() => {
    mockSubmit.mockClear()
    mockTextareaChange.mockClear()
    mockPickImages.mockClear()
    mockViewModel = createMockViewModel()
    setViewport(false)
  })

  it('renders hero section and reacts to textarea input', () => {
    render(<WelcomeScreen />)
    expect(screen.getByRole('heading', { name: /欢迎使用\s*AIChat/ })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('测试占位符')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('测试占位符'), { target: { value: 'hello' } })
    expect(mockTextareaChange).toHaveBeenCalledWith('hello')
  })

  it('keeps the textarea inside the composer shell with a positioned text layer', () => {
    render(<WelcomeScreen />)
    const textarea = screen.getByRole('textbox', { name: '输入消息' })
    const shell = textarea.closest('.composer-shell')!
    expect(shell).not.toBeNull()
    expect(shell.className).toContain('rounded-[var(--radius-composer)]')
    expect(shell.className).toContain('p-4')
    expect(shell.className).toContain('overflow-hidden')
    const layer = textarea.parentElement!
    expect(layer.getAttribute('data-composer-layer')).toBe('text')
    expect(layer.className).toContain('relative')
  })

  it('keeps send isolated from the adaptive tools row', () => {
    render(<WelcomeScreen />)

    const tools = screen.getByRole('button', { name: '工具' })
    const send = screen.getByRole('button', { name: '发送' })
    const toolbar = tools.closest('.composer-toolbar')

    expect(toolbar).not.toBeNull()
    expect(toolbar!.className).toContain('overflow-x-auto')
    expect(toolbar).not.toContainElement(send)
    expect(send.parentElement?.className ?? '').toMatch(/shrink-0/)
    expect(send.parentElement?.className ?? '').toMatch(/relative/)
    expect(send.parentElement?.className ?? '').toMatch(/z-10/)
  })

  it('disables only the send action when the welcome draft is empty', () => {
    mockViewModel.form.query = ''
    mockViewModel.form.attachments.workspaceFiles = []
    render(<WelcomeScreen />)

    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
    // 其他编辑与选择入口不受影响
    expect(screen.getByRole('textbox', { name: '输入消息' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '上传附件' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '工具' })).not.toBeDisabled()
    expect(screen.getByRole('combobox', { name: '选择模型' })).not.toBeDisabled()
  })

  it('keeps attachment-only and typed drafts sendable', () => {
    mockViewModel.form.query = ''
    mockViewModel.form.attachments.workspaceFiles = [{
      localId: 'f1', filename: 'r.pdf', originalName: '调研.pdf', mimeType: 'application/pdf',
      fileSize: 1024, workspacePath: 'input/r.pdf', status: 'ready' as const,
    }]
    const { rerender } = render(<WelcomeScreen />)
    expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled()

    mockViewModel.form.query = '帮我分析这份调研'
    rerender(<WelcomeScreen />)
    expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled()
  })

  it('shows quota below input on mobile instead of placeholder text', async () => {
    setViewport(true)
    mockViewModel.form.basePlaceholder = '本日消息发送额度剩余 195'
    mockViewModel.form.mobileQuotaNotice = '本日消息发送额度剩余 195'

    render(<WelcomeScreen />)

    await waitFor(() => {
      expect(screen.queryByPlaceholderText('本日消息发送额度剩余 195')).not.toBeInTheDocument()
    })
    expect(screen.getByText('本日消息发送额度剩余 195')).toBeInTheDocument()
    expect(isMobileViewport).toBe(true)
  })
})