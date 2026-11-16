import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MobileComposer } from '@/components/chat/mobile-composer'
import { modelKeyFor } from '@/store/model-preference-store'
import { useModelsStore, type ModelItem } from '@/store/models-store'

const mobileModel: ModelItem = {
  id: 'deepseek-v4.1-flash', rawId: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash',
  provider: 'openai', displayName: '工作区主连接', channelName: '工作区主连接',
  connectionId: 7, connectionBaseUrl: 'https://fixture.invalid',
}

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
  showExpand: false,
  onExpandOpen: vi.fn(),
  sendLocked: false,
  sendLockedReason: null,
  onSend: vi.fn(),
  onStop: vi.fn(),
  selectedImages: [],
  onRemoveImage: vi.fn(),
  workspaceFiles: [],
  onRemoveWorkspaceFile: vi.fn(),
  onRetryWorkspaceFile: vi.fn(),
  onPickAttachments: vi.fn(),
  hasAttachments: false,
  attachmentsCount: 0,
  thinkingEnabled: false,
  onToggleThinking: vi.fn(),
  reasoningControl: { value: 'max' as const, onChange: vi.fn() },
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
  deepResearchEnabled: false,
  onToggleDeepResearch: vi.fn(),
  skillOptions: [],
  onToggleSkillOption: vi.fn(),
  placeholder: '继续输入...',
  traceEnabled: false,
  canUseTrace: true,
  onToggleTrace: vi.fn(),
  onOpenAdvanced: vi.fn(),
  selectedModelId: modelKeyFor(mobileModel),
  onModelChange: vi.fn(),
  ...overrides,
})

/** 手机控件的最小触控尺寸由 h-11（2.75rem = 44px）或 .composer-toolbar-btn 变量保证。 */
const expectTouchTarget = (element: HTMLElement) => {
  const classes = element.className
  expect(classes.includes('h-11') || classes.includes('composer-toolbar-btn')).toBe(true)
}

beforeEach(() => {
  localStorage.clear()
  const headerSlot = document.createElement('div')
  headerSlot.id = 'mobile-model-selector'
  document.body.appendChild(headerSlot)
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: query.includes('max-width: 767px'), media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(),
    removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Element.prototype.scrollIntoView = vi.fn()
  useModelsStore.setState({ models: [mobileModel], isLoading: false, error: null })
})

afterEach(() => {
  cleanup()
  document.getElementById('mobile-model-selector')?.remove()
  vi.unstubAllGlobals()
})

describe('MobileComposer layout', () => {
  it('stacks attachments, editor, active capabilities and actions in one editor surface', () => {
    const { container } = render(
      <MobileComposer
        {...createProps({
          workspaceFiles: [{
            localId: 'f1', filename: 'r.pdf', originalName: '调研.pdf', mimeType: 'application/pdf',
            fileSize: 1024, workspacePath: 'input/r.pdf', status: 'ready',
          }],
          hasAttachments: true,
          attachmentsCount: 1,
          thinkingEnabled: true,
          webSearchEnabled: true,
          pythonToolEnabled: true,
        })}
      />,
    )

    const editor = container.querySelector('.composer-inner-editor') as HTMLElement
    expect(editor).not.toBeNull()
    const layers = Array.from(editor.querySelectorAll('[data-composer-layer]')).map(
      (node) => node.getAttribute('data-composer-layer'),
    )
    expect(layers).toEqual(['attachments', 'text', 'actions'])
    expect(within(editor).getByText('调研.pdf')).toBeInTheDocument()
  })

  it('collapses empty attachment and capability rows', () => {
    const { container } = render(<MobileComposer {...createProps()} />)
    const editor = container.querySelector('.composer-inner-editor') as HTMLElement
    const layers = Array.from(editor.querySelectorAll('[data-composer-layer]')).map(
      (node) => node.getAttribute('data-composer-layer'),
    )
    expect(layers).toEqual(['text', 'actions'])
  })

  it('offers a full-screen editor entry at 44px when the draft overflows', () => {
    const onExpandOpen = vi.fn()
    const { container } = render(
      <MobileComposer {...createProps({ showExpand: true, onExpandOpen })} />,
    )

    const expand = screen.getByRole('button', { name: '全屏编辑' })
    expect(expand).toHaveClass('h-11', 'w-11')
    expect(container.querySelector('textarea')?.className).toContain('pr-11')
    expand.click()
    expect(onExpandOpen).toHaveBeenCalledTimes(1)
  })

  it('hides the full-screen entry while the draft fits', () => {
    render(<MobileComposer {...createProps({ showExpand: false })} />)
    expect(screen.queryByRole('button', { name: '全屏编辑' })).not.toBeInTheDocument()
  })

  it('keeps every bottom action at least 44px tall', () => {
    render(<MobileComposer {...createProps()} />)

    expectTouchTarget(screen.getByRole('button', { name: '上传附件' }))
    expectTouchTarget(screen.getByRole('button', { name: '工具' }))
    expectTouchTarget(screen.getByRole('combobox', { name: '选择模型' }))
    expectTouchTarget(screen.getByRole('button', { name: '发送' }))
  })

  it('shows a readable short model name while keeping the full identity one gesture away', () => {
    render(<MobileComposer {...createProps()} />)

    const trigger = screen.getByRole('combobox', { name: '选择模型' })
    // 可见文本是短名 + 强度；完整身份只在 title 与 sr-only 描述里。
    expect(trigger.querySelector('.font-medium')?.textContent).toBe('V4.1 Flash')
    expect(trigger).toHaveTextContent('Max')
    expect(trigger.getAttribute('title')).toContain('DeepSeek V4.1 Flash')

    const describedBy = trigger.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy as string)?.textContent).toContain('DeepSeek V4.1 Flash')
    expect(document.getElementById(describedBy as string)?.textContent).toContain('Max')
  })
})

describe('MobileComposer tools and capabilities', () => {
  it('opens the bottom tools sheet from the tools trigger', async () => {
    render(<MobileComposer {...createProps()} />)

    screen.getByRole('button', { name: '工具' }).click()
    expect(await screen.findByRole('dialog', { name: '工具' })).toBeInTheDocument()
    expect(await screen.findByRole('switch', { name: '深度思考' })).toBeInTheDocument()
  })

  it('closes the tools sheet before opening a context overlay', async () => {
    const onOpenSessionPrompt = vi.fn()
    render(<MobileComposer {...createProps({ onOpenSessionPrompt })} />)

    fireEvent.click(screen.getByRole('button', { name: '工具' }))
    fireEvent.click(await screen.findByRole('tab', { name: '上下文与设置' }))
    fireEvent.click(screen.getByRole('button', { name: /会话系统提示词/ }))

    // 回归：面板必须先收起（否则仍在退场的 z-50 模态层会拦住下一个弹层的按钮），
    // 目标弹层在退场结束后才打开。
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '工具' })).not.toBeInTheDocument())
    expect(onOpenSessionPrompt).not.toHaveBeenCalled()
    await waitFor(() => expect(onOpenSessionPrompt).toHaveBeenCalledTimes(1), { timeout: 1500 })
  })

  it('keeps fitting capability icons in the same action row', () => {
    render(
      <MobileComposer
        {...createProps({ thinkingEnabled: true, webSearchEnabled: true, pythonToolEnabled: true })}
      />,
    )

    const chips = screen.getByRole('group', { name: '已启用能力' })
    expect(within(chips).getByRole('button', { name: '思考' })).toBeInTheDocument()
    expect(within(chips).getByRole('button', { name: '联网' })).toBeInTheDocument()
    expect(within(chips).getByRole('button', { name: 'Python' })).toBeInTheDocument()
    expect(chips.closest('[data-composer-layer="actions"]')).not.toBeNull()
    const model = screen.getByRole('combobox', { name: '选择模型' })
    expect(document.getElementById('mobile-model-selector')).toContainElement(model)
    expect(chips.closest('[data-composer-layer="actions"]')).not.toContainElement(model)
  })

  it('sends web search chips straight to the scope page', async () => {
    render(<MobileComposer {...createProps({ webSearchEnabled: true, showWebSearchScope: true })} />)

    screen.getByRole('button', { name: '联网' }).click()
    expect(await screen.findByRole('region', { name: '搜索范围设置' })).toBeInTheDocument()
  })

  it('opens the model selector on the effort view for the thinking chip', async () => {
    render(<MobileComposer {...createProps({ thinkingEnabled: true })} />)

    screen.getByRole('button', { name: '思考' }).click()
    expect(await screen.findByRole('list', { name: '思考强度选项' })).toBeInTheDocument()
  })
})