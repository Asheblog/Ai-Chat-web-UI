import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ChatPageClient } from '../chat-page-client'
import { useChatStore } from '@/store/chat-store'
import type { ChatSession } from '@/types'

vi.mock('@/components/welcome-screen', () => ({
  WelcomeScreen: () => <div data-testid="welcome-screen">欢迎页</div>,
}))

vi.mock('@/components/chat-interface', () => ({
  ChatInterface: () => <div data-testid="chat-interface">聊天界面</div>,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/main',
}))

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...rest }: { children: React.ReactNode; [key: string]: unknown }) => (
      <div {...rest}>{children}</div>
    ),
  },
}))

vi.mock('@/store/settings-store', () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) => {
    const state = {
      fetchSystemSettings: vi.fn(),
      hasSystemSettings: false,
      systemSettings: null,
    }
    return selector(state)
  },
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
})
