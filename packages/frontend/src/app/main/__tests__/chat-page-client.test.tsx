import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { cleanup } from '@testing-library/react'
import { ChatPageClient } from '../chat-page-client'
import { useChatStore } from '@/store/chat-store'
import type { ChatSession } from '@/types'
import * as chatApi from '@/features/chat/api'

vi.mock('@/components/welcome-screen', () => ({
  WelcomeScreen: () => <div data-testid="welcome-screen">欢迎页</div>,
}))

vi.mock('@/components/chat-interface', () => ({
  ChatInterface: () => <div data-testid="chat-interface">聊天界面</div>,
}))

const navigationMocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => navigationMocks.router,
  usePathname: () => '/main',
}))

vi.mock('@/features/chat/api', () => ({
  getSessions: vi.fn().mockResolvedValue({ data: [] }),
  getSessionsUsage: vi.fn().mockResolvedValue({ success: true, data: [] }),
  getUsage: vi.fn().mockResolvedValue({ data: {} }),
  getMessages: vi.fn().mockResolvedValue({ data: { messages: [], pagination: {} } }),
  getMessageByClientId: vi.fn(),
  getSessionArtifacts: vi.fn().mockResolvedValue({ data: [] }),
  updateUserMessage: vi.fn(),
  createSessionByModelId: vi.fn(),
  deleteSession: vi.fn(),
  deleteSessions: vi.fn(),
  updateSession: vi.fn(),
  updateSessionModel: vi.fn(),
  cancelStream: vi.fn(),
  cancelAgentStream: vi.fn(),
}))


const mockSession: ChatSession = {
  id: 42,
  title: 'Existing Chat',
  createdAt: new Date().toISOString(),
  modelLabel: 'gpt-4',
  modelRawId: 'gpt-4',
  connectionId: 1,
} as ChatSession

const emptyStoreState = () => ({
  currentSession: null,
  sessions: [],
  messageMetas: [],
  messageBodies: {},
  messageRenderCache: {},
  isSessionsLoading: false,
  isMessagesLoading: false,
  isStreaming: false,
  activeStreamSessionId: null,
  error: null,
  messageImageCache: {},
  messagesHydrated: {},
  messagePaginationBySession: {},
  usageCurrent: null,
  usageLastRound: null,
  usageTotals: null,
  sessionUsageTotalsMap: {},
  toolEvents: [],
  assistantVariantSelections: {},
  messageMetrics: {},
  shareSelection: { enabled: false, sessionId: null, selectedMessageIds: [] },
})

describe('ChatPageClient - /main route regression', () => {
  beforeEach(() => {
    useChatStore.setState(emptyStoreState())
    vi.mocked(chatApi.getSessions).mockClear()
    vi.mocked(chatApi.getSessionsUsage).mockClear()
    vi.mocked(chatApi.getMessages).mockClear()
    vi.mocked(chatApi.getMessages).mockResolvedValue({ data: [], pagination: {} } as never)
    vi.mocked(chatApi.getSessions).mockResolvedValue({ data: [] })
    vi.mocked(chatApi.getSessionsUsage).mockResolvedValue({ success: true, data: [] })
  })

  afterEach(() => {
    cleanup()
  })

  it('should not loop sessions/usage fetches on empty homepage', async () => {
    render(<ChatPageClient initialSessionId={null} />)

    await waitFor(() => {
      expect(screen.getByTestId('welcome-screen')).toBeInTheDocument()
    })

    // 等若干宏任务：若 effect 依赖 isSessionsLoading，空列表会反复 fetchSessions→usage
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(chatApi.getSessions).toHaveBeenCalledTimes(1)
    expect(chatApi.getSessionsUsage).toHaveBeenCalledTimes(1)
  })

  it('should clear currentSession and render WelcomeScreen when entering /main with active session', async () => {
    // 模拟用户已有 currentSession 时导航到 /main 真实症状
    useChatStore.setState({
      sessions: [mockSession] as any,
      currentSession: mockSession as any,
    })

    render(<ChatPageClient initialSessionId={null} />)

    // 等待 effect 中的 ensureSelection 清空 currentSession
    await waitFor(() => {
      expect(screen.getByTestId('welcome-screen')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('chat-interface')).not.toBeInTheDocument()
    expect(useChatStore.getState().currentSession).toBeNull()
  })

  it('should render ChatInterface when navigating to /main/[sessionId]', async () => {
    useChatStore.setState({
      sessions: [mockSession] as any,
      currentSession: mockSession as any,
    })

    render(<ChatPageClient initialSessionId={42} />)

    await waitFor(() => {
      expect(screen.getByTestId('chat-interface')).toBeInTheDocument()
    })
  })

  it('已知路由会话在 sessions 返回前优先选择并加载消息', async () => {
    let resolveSessions: (value: { data: ChatSession[] }) => void = () => {}
    vi.mocked(chatApi.getSessions).mockReturnValue(
      new Promise((resolve) => {
        resolveSessions = resolve
      }) as never,
    )
    vi.mocked(chatApi.getMessages).mockResolvedValue({ data: [], pagination: {} } as never)

    render(<ChatPageClient initialSessionId={42} />)

    await waitFor(() => {
      expect(useChatStore.getState().currentSession?.id).toBe(42)
    })
    expect(chatApi.getMessages).toHaveBeenCalledWith(42, expect.any(AbortSignal), expect.any(Object))
    expect(useChatStore.getState().currentSession?.title).toBe('')
    expect(screen.queryByText('正在恢复会话…')).not.toBeInTheDocument()

    await act(async () => {
      resolveSessions({ data: [mockSession] })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(useChatStore.getState().currentSession?.title).toBe('Existing Chat')
    })
    expect(chatApi.getMessages).toHaveBeenCalledTimes(1)
  })

  it('无效会话在消息失败后回退首位会话，不重复请求同一路由消息', async () => {
    vi.mocked(chatApi.getSessions).mockResolvedValue({ data: [mockSession] })
    vi.mocked(chatApi.getMessages).mockRejectedValue(new Error('not found'))

    render(<ChatPageClient initialSessionId={999} />)

    await waitFor(() => {
      expect(useChatStore.getState().currentSession?.id).toBe(42)
    })
    expect(navigationMocks.router.replace).toHaveBeenCalledWith('/main/42')
    const invalidRouteCalls = vi
      .mocked(chatApi.getMessages)
      .mock.calls.filter((call) => call[0] === 999)
    expect(invalidRouteCalls).toHaveLength(1)
    expect(chatApi.getMessages).toHaveBeenCalledWith(42, expect.any(AbortSignal), expect.any(Object))
  })
})
