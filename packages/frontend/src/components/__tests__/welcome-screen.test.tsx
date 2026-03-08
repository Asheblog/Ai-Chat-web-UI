import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { WelcomeScreen } from '@/components/welcome-screen'

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
      fileInputRef: { current: null },
      onRemoveImage: vi.fn(),
      onFilesSelected: vi.fn(),
      onPickImages: mockPickImages,
      onPaste: vi.fn(),
      documents: [],
      onRemoveDocument: vi.fn(),
      onCancelDocument: vi.fn(),
      onPickDocuments: vi.fn(),
      onDocumentFilesSelected: vi.fn(),
      documentInputRef: { current: null },
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
  ModelSelector: ({ selectedModelId, onModelChange }: any) => (
    <button type="button" data-testid="model-selector" onClick={() => onModelChange({ id: 'model-b' })}>
      {selectedModelId || '选择模型'}
    </button>
  ),
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
    expect(screen.getByText('有什么可以帮忙的?')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('测试占位符')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('测试占位符'), { target: { value: 'hello' } })
    expect(mockTextareaChange).toHaveBeenCalledWith('hello')
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
