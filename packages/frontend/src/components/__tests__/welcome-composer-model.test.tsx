import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WelcomeScreen } from '@/components/welcome-screen'
import { modelKeyFor } from '@/store/model-preference-store'
import { useModelsStore, type ModelItem } from '@/store/models-store'

const { onSubmit, onModelChange } = vi.hoisted(() => ({ onSubmit: vi.fn(), onModelChange: vi.fn() }))
vi.mock('@/components/user-menu', () => ({ UserMenu: () => <div /> }))
vi.mock('@/features/chat/welcome/useWelcomeScreenViewModel', () => ({
  useWelcomeScreenViewModel: () => ({
    header: { selectedModelId: '31:gpt-4.1', onModelChange, disabled: false, isCreating: false },
    hero: { quotaExhausted: false, brandText: 'AIChat' },
    footerNote: '欢迎页验收',
    form: {
      query: '请整理发布计划', isComposing: false, setIsComposing: vi.fn(), textareaRef: { current: null },
      basePlaceholder: '输入消息', mobilePlaceholder: '输入消息', mobileQuotaNotice: null,
      creationDisabled: false, isCreating: false, showExpand: false,
      onTextareaChange: vi.fn(), onKeyDown: vi.fn(), onSubmit, onOpenExpand: vi.fn(),
      expand: { open: false, draft: '', onChange: vi.fn(), onClose: vi.fn(), onApply: vi.fn() },
      attachments: {
        selectedImages: [], onRemoveImage: vi.fn(), onPaste: vi.fn(), workspaceFiles: [],
        onRemoveWorkspaceFile: vi.fn(), attachmentInputRef: { current: null },
        pickAttachments: vi.fn(), onAttachmentsSelected: vi.fn(),
      },
      knowledgeBase: {
        enabled: false, availableKbs: [], selectedKbIds: [], isLoading: false, error: null,
        onToggle: vi.fn(), onSelectAll: vi.fn(), onClearAll: vi.fn(), onRefresh: vi.fn(),
        selectorOpen: false, onOpenSelector: vi.fn(), onSelectorOpenChange: vi.fn(),
      },
      advancedOptions: {
        disabled: false, thinkingEnabled: false, onToggleThinking: vi.fn(), effort: 'unset',
        onEffortChange: vi.fn(), webSearchEnabled: true, onToggleWebSearch: vi.fn(),
        canUseWebSearch: true, showWebSearchScope: false, webSearchScope: 'webpage',
        onWebSearchScopeChange: vi.fn(), pythonToolEnabled: true, onTogglePythonTool: vi.fn(),
        canUsePythonTool: true, deepResearchEnabled: false, onToggleDeepResearch: vi.fn(),
        skillOptions: [], onToggleSkillOption: vi.fn(), onOpenAdvanced: vi.fn(), onOpenSessionPrompt: vi.fn(),
      },
      advancedDialog: {
        open: false, onClose: vi.fn(), customHeaders: [], onAddHeader: vi.fn(), onHeaderChange: vi.fn(),
        onRemoveHeader: vi.fn(), canAddHeader: true, customBodyInput: '', onCustomBodyChange: vi.fn(), customBodyError: null,
      },
      sessionPromptDialog: {
        open: false, value: '', onChange: vi.fn(), onClose: vi.fn(), onConfirm: vi.fn(), onClear: vi.fn(), placeholder: '',
      },
    },
  }),
}))
const selectedModel: ModelItem = {
  id: 'gpt-4.1', rawId: 'gpt-4.1', name: 'GPT-4.1 欢迎页超长中文模型名称 · 工作区主连接',
  provider: 'openai', displayName: '工作区主连接', channelName: '工作区主连接',
  connectionId: 31, connectionBaseUrl: 'https://fixture.invalid',
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Element.prototype.scrollIntoView = vi.fn()
  useModelsStore.setState({ models: [selectedModel], isLoading: false, error: null })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Welcome composer model action', () => {
  it('places the selected long-name model in the composer without submitting when opened', async () => {
    const user = userEvent.setup()
    render(<WelcomeScreen />)
    const textbox = screen.getByRole('textbox', { name: '输入消息' })
    const composer = textbox.closest('.composer-shell')
    expect(composer).not.toBeNull()
    const trigger = within(composer as HTMLElement).getByRole('combobox', { name: '选择模型' })
    const send = within(composer as HTMLElement).getByRole('button', { name: '发送' })
    expect(trigger).toHaveTextContent(selectedModel.name)
    const tools = composer!.querySelector('.composer-toolbar')
    expect(tools).not.toContainElement(trigger)
    expect(tools).not.toContainElement(send)
    await user.click(trigger)
    expect(await screen.findByPlaceholderText('搜索模型 / 厂商 / 能力')).toBeVisible()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onModelChange).not.toHaveBeenCalled()
    expect(modelKeyFor(selectedModel)).toBe('31:gpt-4.1')
  })
})
