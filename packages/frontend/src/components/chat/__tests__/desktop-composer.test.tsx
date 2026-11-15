import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { DesktopComposer } from '@/components/chat/desktop-composer'
import type { WorkspaceFile } from '@/features/chat/composer'
import { modelKeyFor } from '@/store/model-preference-store'
import { useModelsStore, type ModelItem } from '@/store/models-store'

const desktopModel: ModelItem = {
  id: 'gpt-4.1', rawId: 'gpt-4.1', name: 'GPT-4.1', provider: 'openai',
  displayName: '工作区主连接', channelName: '工作区主连接',
  connectionId: 21, connectionBaseUrl: 'https://fixture.invalid',
}

const readyFile: WorkspaceFile = {
  localId: 'f1',
  filename: 'report.pdf',
  originalName: '2026 产品体验调研.pdf',
  mimeType: 'application/pdf',
  fileSize: 20480,
  workspacePath: 'input/report.pdf',
  status: 'ready',
}

const failedFile: WorkspaceFile = {
  localId: 'f2',
  filename: '',
  originalName: 'failed.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  fileSize: 1024,
  workspacePath: '',
  status: 'error',
  errorMessage: '413 文件过大',
}

const createProps = (
  overrides: Partial<React.ComponentProps<typeof DesktopComposer>> = {},
): React.ComponentProps<typeof DesktopComposer> => ({
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
  workspaceFiles: [],
  onRemoveWorkspaceFile: vi.fn(),
  onRetryWorkspaceFile: vi.fn(),
  onPickAttachments: vi.fn(),
  hasAttachments: false,
  attachmentsCount: 0,
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
  deepResearchEnabled: false,
  onToggleDeepResearch: vi.fn(),
  skillOptions: [],
  onToggleSkillOption: vi.fn(),
  traceEnabled: false,
  canUseTrace: true,
  onToggleTrace: vi.fn(),
  reasoningControl: { value: 'unset' as const, onChange: vi.fn() },
  selectedModelId: modelKeyFor(desktopModel),
  onModelChange: vi.fn(),
  showExpand: false,
  onExpandOpen: vi.fn(),
  onOpenAdvanced: vi.fn(),
  onOpenSessionPrompt: vi.fn(),
  onSend: vi.fn(),
  onStop: vi.fn(),
  desktopSendDisabled: false,
  sendLockedReason: null,
  onOpenKnowledgeBase: vi.fn(),
  knowledgeBaseEnabled: true,
  knowledgeBaseCount: 0,
  ...overrides,
})

beforeEach(() => {
  useModelsStore.setState({ models: [desktopModel], isLoading: false, error: null })
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: query.includes('min-width: 768px'), media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(),
    removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const layerOrder = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-composer-layer]')).map(
    (node) => node.getAttribute('data-composer-layer'),
  )

describe('DesktopComposer layout', () => {
  it('stacks attachments, editor, active capabilities and actions inside one shell', () => {
    const { container } = render(
      <DesktopComposer
        {...createProps({
          workspaceFiles: [readyFile],
          hasAttachments: true,
          attachmentsCount: 1,
          thinkingEnabled: true,
          webSearchEnabled: true,
        })}
      />,
    )

    const shell = container.querySelector('.composer-shell') as HTMLElement
    expect(shell).not.toBeNull()
    expect(layerOrder(shell)).toEqual(['attachments', 'text', 'capabilities', 'actions'])
    expect(within(shell).getByText('2026 产品体验调研.pdf')).toBeInTheDocument()
    expect(within(shell).getByRole('group', { name: '已启用能力' })).toBeInTheDocument()
  })

  it('collapses the attachment and capability rows when nothing is attached or enabled', () => {
    const { container } = render(<DesktopComposer {...createProps()} />)

    const shell = container.querySelector('.composer-shell') as HTMLElement
    expect(layerOrder(shell)).toEqual(['text', 'actions'])
    expect(within(shell).queryByRole('group', { name: '已启用能力' })).not.toBeInTheDocument()
  })

  it('orders attachment, tools, model and send in the bottom action bar', () => {
    const { container } = render(<DesktopComposer {...createProps()} />)
    const shell = container.querySelector('.composer-shell') as HTMLElement

    const actions = shell.querySelector('[data-composer-layer="actions"]') as HTMLElement
    const order = ['上传附件', '工具', '选择模型', '发送'].map((name) =>
      within(actions).getByRole(name === '选择模型' ? 'combobox' : 'button', { name }),
    )
    for (let index = 1; index < order.length; index += 1) {
      expect(order[index - 1].compareDocumentPosition(order[index])).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      )
    }
    expect(within(actions).queryByRole('button', { name: '更多操作' })).not.toBeInTheDocument()
  })

  it('uses the 16px editor type for writing', () => {
    const { container } = render(<DesktopComposer {...createProps()} />)
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea.className).toContain('text-[16px]')
    expect(textarea.className).not.toContain('text-sm')
  })

  it('anchors the full-screen editor action to the text row when there is content', () => {
    const { container } = render(<DesktopComposer {...createProps({ showExpand: true })} />)
    const textLayer = container.querySelector('[data-composer-layer="text"]') as HTMLElement
    const expand = within(textLayer).getByRole('button', { name: '全屏编辑' })

    expect(textLayer.className).toContain('relative')
    expect(expand.className).toContain('absolute')
    expect((container.querySelector('textarea') as HTMLTextAreaElement).className).toContain('pr-12')
  })

  it('offers retry and remove on a failed attachment card', () => {
    const onRetryWorkspaceFile = vi.fn()
    render(
      <DesktopComposer
        {...createProps({
          workspaceFiles: [failedFile],
          hasAttachments: true,
          attachmentsCount: 1,
          onRetryWorkspaceFile,
        })}
      />,
    )

    screen.getByRole('button', { name: '重试 failed.xlsx' }).click()
    expect(onRetryWorkspaceFile).toHaveBeenCalledExactlyOnceWith('f2')
    expect(screen.getByRole('button', { name: '移除 failed.xlsx' })).toBeInTheDocument()
  })
})

describe('DesktopComposer actions', () => {
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

    stopButton.click()
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

    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
  })

  it('keeps send and model isolated from the scrolling tools row', () => {
    render(<DesktopComposer {...createProps()} />)

    const tools = screen.getByRole('button', { name: '工具' })
    const send = screen.getByRole('button', { name: '发送' })
    const model = screen.getByRole('combobox', { name: '选择模型' })
    const scrollRow = tools.closest('.composer-toolbar')

    expect(scrollRow).not.toBeNull()
    expect(scrollRow!.className).toContain('overflow-x-auto')
    expect(scrollRow).not.toContainElement(send)
    expect(scrollRow).not.toContainElement(model)
    expect(send.parentElement?.className ?? '').toMatch(/shrink-0/)
    expect(send.parentElement?.className ?? '').toMatch(/z-10/)
  })

  it('closes the tools surface before opening a context overlay', async () => {
    const onOpenSessionPrompt = vi.fn()
    render(<DesktopComposer {...createProps({ onOpenSessionPrompt })} />)

    screen.getByRole('button', { name: '工具' }).click()
    // 桌面面板没有页签，上下文动作与能力行同屏
    const action = await screen.findByRole('button', { name: /会话系统提示词/ })
    vi.useFakeTimers()
    try {
      act(() => action.click())
      expect(screen.queryByRole('switch', { name: '深度思考' })).not.toBeInTheDocument()
      expect(onOpenSessionPrompt).not.toHaveBeenCalled()
      act(() => vi.advanceTimersByTime(219))
      expect(onOpenSessionPrompt).not.toHaveBeenCalled()
      act(() => vi.advanceTimersByTime(1))
      expect(onOpenSessionPrompt).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('opens the tools surface from the tools trigger', async () => {
    render(<DesktopComposer {...createProps({ thinkingEnabled: true })} />)

    screen.getByRole('button', { name: '工具' }).click()
    expect(await screen.findByRole('switch', { name: '深度思考' })).toBeInTheDocument()
  })
})