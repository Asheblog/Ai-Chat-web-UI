import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { useChatSessionControls } from '@/hooks/use-chat-session-controls'
import { useWelcomeScreenViewModel } from '../useWelcomeScreenViewModel'
import { WelcomeScreen } from '@/components/welcome-screen'
import { useAuthStore } from '@/store/auth-store'
import { useChatStore } from '@/store/chat-store'
import { useModelsStore, type ModelItem } from '@/store/models-store'
import { modelKeyFor, useModelPreferenceStore } from '@/store/model-preference-store'
import { useSettingsStore } from '@/store/settings-store'
import { useReasoningEffortPreferenceStore } from '@/store/reasoning-effort-preference-store'

const imageFixture = { dataUrl: 'data:image/png;base64,AAAA', mime: 'image/png', size: 1024 }
let mockImages: Array<typeof imageFixture> = []

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/components/user-menu', () => ({ UserMenu: () => null }))
vi.mock('@/features/chat/composer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/chat/composer')>()
  return {
    ...actual,
    // 只把图片解码换成可控状态，其余（发送、建会话）走真实实现与真实 store。
    useImageAttachments: () => ({
      selectedImages: mockImages,
      setSelectedImages: vi.fn(),
      removeImage: vi.fn(),
      validateImage: vi.fn(async () => ({ ok: false })),
      handlePaste: vi.fn(),
      limits: { maxCount: 5, maxMb: 10, maxEdge: 2048, maxTotalMb: 20 },
    }),
  }
})

const model: ModelItem = {
  id: 'gpt-4.1', rawId: 'gpt-4.1', name: '工作区主模型', provider: 'openai',
  channelName: '工作区主连接', connectionId: 31, connectionBaseUrl: 'https://fixture.invalid',
}

const createSession = vi.fn()
const streamMessage = vi.fn()

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.clearAllMocks()
  mockImages = []
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Element.prototype.scrollIntoView = vi.fn()
  useModelPreferenceStore.getState().clear()
  useReasoningEffortPreferenceStore.getState().clear()
  useModelsStore.setState({ models: [model], isLoading: false, error: null })
  useAuthStore.setState({ actor: null, user: null, actorState: 'anonymous', quota: null })
  useSettingsStore.setState({ systemSettings: null, publicBrandText: 'AIChat' })
  createSession.mockImplementation(async () => {
    useChatStore.setState({ currentSession: { id: 501 } as never })
    return { id: 501 }
  })
  streamMessage.mockImplementation(async () => undefined)
  useChatStore.setState({ createSession, streamMessage } as never)
})

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const textarea = () => screen.getByRole('textbox', { name: '输入消息' })

describe('欢迎页发送守卫（真实 handleCreate 路径）', () => {
  it('聊天选择的模型与 Max 在欢迎页、刷新后和首条消息中继承', async () => {
    const recentModel = { ...model, id: 'deepseek-v4.1-flash', rawId: 'deepseek-v4.1-flash' }
    useModelsStore.setState({ models: [model, recentModel] })
    const updateSessionPrefs = vi.fn().mockResolvedValue(true)
    const switchSessionModel = vi.fn()
    useChatStore.setState({ currentSession: { id: 42 } as never, updateSessionPrefs, switchSessionModel })
    const controls = renderHook(() => useChatSessionControls({
      currentSession: useChatStore.getState().currentSession, canUseWebSearch: false,
      setThinkingEnabled: vi.fn(), setWebSearchEnabled: vi.fn(), setEffort: vi.fn(),
    }))
    act(() => {
      controls.result.current.handleModelChange(recentModel)
      controls.result.current.updateEffort('max')
    })
    controls.unmount()
    const welcome = renderHook(() => useWelcomeScreenViewModel())
    await waitFor(() => expect(welcome.result.current.header.selectedModelId).toBe(modelKeyFor(recentModel)))
    expect(welcome.result.current.form.advancedOptions.effort).toBe('max')
    welcome.unmount()
    const restored = renderHook(() => useWelcomeScreenViewModel())
    await waitFor(() => expect(restored.result.current.form.advancedOptions.effort).toBe('max'))
    act(() => restored.result.current.form.onTextareaChange('帮我分析这段代码'))
    await act(async () => restored.result.current.form.onSubmit())
    expect(createSession.mock.calls[0][0]).toBe(recentModel.id)
    expect(createSession.mock.calls[0][5]).toEqual({ reasoningEffort: 'max' })
    expect(streamMessage.mock.calls[0][3]).toMatchObject({ reasoningEffort: 'max' })
    expect(JSON.parse(localStorage.getItem('reasoning-effort-preference')!).state.lastSelection).toBe('max')
  })

  it('欢迎页未显式选择强度时保留系统兜底，不固定为会话覆盖值', async () => {
    useSettingsStore.setState({ systemSettings: { openaiReasoningEffort: 'medium' } as never })
    const welcome = renderHook(() => useWelcomeScreenViewModel())
    await waitFor(() => expect(welcome.result.current.form.advancedOptions.effort).toBe('medium'))
    act(() => welcome.result.current.form.onTextareaChange('跟随系统设置'))
    await act(async () => welcome.result.current.form.onSubmit())
    expect(createSession.mock.calls[0][5]).toEqual({ reasoningEffort: undefined })
    expect(useReasoningEffortPreferenceStore.getState().lastSelection).toBeNull()
  })

  it('欢迎页显式选择默认覆盖之前的 Max，重新打开仍为默认', async () => {
    useReasoningEffortPreferenceStore.getState().setLastSelection('max')
    useSettingsStore.setState({ systemSettings: { openaiReasoningEffort: 'medium' } as never })
    const welcome = renderHook(() => useWelcomeScreenViewModel())
    await waitFor(() => expect(welcome.result.current.form.advancedOptions.effort).toBe('max'))
    act(() => welcome.result.current.form.advancedOptions.onEffortChange('unset'))
    welcome.unmount()
    const restored = renderHook(() => useWelcomeScreenViewModel())
    await waitFor(() => expect(restored.result.current.form.advancedOptions.effort).toBe('unset'))
    act(() => restored.result.current.form.onTextareaChange('使用默认强度'))
    await act(async () => restored.result.current.form.onSubmit())
    expect(createSession.mock.calls[0][5]).toEqual({ reasoningEffort: 'unset' })
    expect(streamMessage.mock.calls[0][3]?.reasoningEffort).toBeUndefined()
  })

  it('空草稿按 Enter 不创建会话', async () => {
    render(<WelcomeScreen />)

    fireEvent.keyDown(textarea(), { key: 'Enter' })
    await waitFor(() => expect(textarea()).toBeInTheDocument())

    expect(createSession).not.toHaveBeenCalled()
    expect(streamMessage).not.toHaveBeenCalled()
  })

  it('空草稿调用共享提交入口（表单 onKeyDown → handleCreate）同样不建会话', async () => {
    render(<WelcomeScreen />)

    // 直接走 textarea 的 keydown 处理器，等价于键盘与程序化提交两条路径
    fireEvent.keyDown(textarea(), { key: 'Enter', shiftKey: false })
    expect(createSession).not.toHaveBeenCalled()

    fireEvent.change(textarea(), { target: { value: '帮我整理发布计划' } })
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1))
  })

  it('图片-only 发送：建会话后随首条消息带上图片与回退文案', async () => {
    mockImages = [imageFixture]
    render(<WelcomeScreen />)

    fireEvent.keyDown(textarea(), { key: 'Enter' })
    await waitFor(() => expect(streamMessage).toHaveBeenCalledTimes(1))

    const [, message, images] = streamMessage.mock.calls[0]
    expect(message).toContain('请查看这些图片')
    expect(images).toEqual([{ data: 'AAAA', mime: 'image/png' }])
    expect(createSession).toHaveBeenCalledTimes(1)
  })

  it('图片存在但无文字时发送按钮仍可用', () => {
    mockImages = [imageFixture]
    render(<WelcomeScreen />)
    expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled()
  })
})
