import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DesktopComposer } from '@/components/chat/desktop-composer'
import { MobileComposer } from '@/components/chat/mobile-composer'
import { modelKeyFor } from '@/store/model-preference-store'
import { useModelsStore, type ModelItem } from '@/store/models-store'

const model: ModelItem = {
  id: 'gpt-4.1', rawId: 'gpt-4.1', name: 'GPT-4.1 超长中文模型名称 · 产品研发工作专用连接',
  provider: 'openai', displayName: '产品研发连接', channelName: '产品研发连接',
  connectionId: 21, connectionBaseUrl: 'https://fixture.invalid',
}

type ModelActions = { selectedModelId: string; onModelChange: (model: ModelItem) => void }
function commonProps() {
  const effort: 'unset' = 'unset'
  return {
    input: '请整理当前发布计划', textareaRef: { current: null }, onInputChange: vi.fn(),
    onKeyDown: vi.fn(), onPaste: vi.fn(), onCompositionStart: vi.fn(), onCompositionEnd: vi.fn(),
    placeholder: '输入消息', isStreaming: false, selectedImages: [], onRemoveImage: vi.fn(),
    workspaceFiles: [], onRemoveWorkspaceFile: vi.fn(), onPickAttachments: vi.fn(),
    hasAttachments: false, attachmentsCount: 0, thinkingEnabled: false, onToggleThinking: vi.fn(),
    webSearchEnabled: true, onToggleWebSearch: vi.fn(), webSearchScope: 'webpage',
    onWebSearchScopeChange: vi.fn(), showWebSearchScope: false, canUseWebSearch: true,
    pythonToolEnabled: true, onTogglePythonTool: vi.fn(), canUsePythonTool: true,
    deepResearchEnabled: false, onToggleDeepResearch: vi.fn(), skillOptions: [],
    onToggleSkillOption: vi.fn(), traceEnabled: false, canUseTrace: true, onToggleTrace: vi.fn(),
    effort, onEffortChange: vi.fn(), onOpenAdvanced: vi.fn(), onSend: vi.fn(), onStop: vi.fn(),
    selectedModelId: modelKeyFor(model), onModelChange: vi.fn(),
  }
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: query === '(max-width: 767px)', media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(),
    removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Element.prototype.scrollIntoView = vi.fn()
  useModelsStore.setState({ models: [model], isLoading: false, error: null })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Composer model and send action isolation', () => {
  it('desktop exposes the selected long model outside the scrolling tools and never sends while opening it', async () => {
    const props: React.ComponentProps<typeof DesktopComposer> & ModelActions = {
      ...commonProps(), textareaDisabled: false, showExpand: false, onExpandOpen: vi.fn(),
      onOpenSessionPrompt: vi.fn(), desktopSendDisabled: false, sendLockedReason: null,
    }
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: false, media: query, onchange: null, addEventListener: vi.fn(),
      removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })))
    const user = userEvent.setup()
    render(<DesktopComposer {...props} />)
    const trigger = screen.getByRole('combobox', { name: '选择模型' })
    const send = screen.getByRole('button', { name: '发送' })
    expect(trigger).toHaveTextContent(model.name)
    const tools = document.querySelector('.composer-toolbar')
    expect(tools).not.toContainElement(trigger)
    expect(tools).not.toContainElement(send)
    expect(trigger.contains(send) || send.contains(trigger)).toBe(false)
    await user.click(trigger)
    expect(props.onSend).not.toHaveBeenCalled()
    expect(await screen.findByRole('textbox', { name: '搜索模型或供应商' })).toBeVisible()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(send)
    expect(props.onSend).toHaveBeenCalledTimes(1)
    expect(props.onModelChange).not.toHaveBeenCalled()
  })

  it('mobile keeps long model selection and send as independent actions outside tool scrolling', async () => {
    const props: React.ComponentProps<typeof MobileComposer> & ModelActions = {
      ...commonProps(), sendLocked: false, sendLockedReason: null,
    }
    const user = userEvent.setup()
    render(<MobileComposer {...props} />)
    const trigger = screen.getByRole('combobox', { name: '选择模型' })
    const send = screen.getByRole('button', { name: '发送' })
    expect(trigger).toHaveTextContent(model.name)
    const tools = document.querySelector('.composer-toolbar')
    expect(tools).not.toContainElement(trigger)
    expect(tools).not.toContainElement(send)
    expect(trigger.contains(send) || send.contains(trigger)).toBe(false)
    await user.click(trigger)
    expect(await screen.findByRole('dialog', { name: '选择模型' })).toBeVisible()
    expect(props.onSend).not.toHaveBeenCalled()
  })
})
