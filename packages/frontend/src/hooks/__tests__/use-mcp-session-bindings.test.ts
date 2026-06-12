import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useMcpSessionBindings } from '@/hooks/use-mcp-session-bindings'

const mockListConnections = vi.fn()
const mockListBindings = vi.fn()
const mockListSessionTools = vi.fn()
const mockCreateBinding = vi.fn()
const mockUpdateBinding = vi.fn()

vi.mock('@/features/mcp/api', () => ({
  listConnections: (...args: any[]) => mockListConnections(...args),
  listBindings: (...args: any[]) => mockListBindings(...args),
  listSessionTools: (...args: any[]) => mockListSessionTools(...args),
  createBinding: (...args: any[]) => mockCreateBinding(...args),
  updateBinding: (...args: any[]) => mockUpdateBinding(...args),
}))

const mockUseAuthStore = vi.fn()

vi.mock('@/store/auth-store', () => ({
  useAuthStore: (selector: any) => mockUseAuthStore(selector),
}))

function mockAuthenticated() {
  mockUseAuthStore.mockImplementation((selector: any) => {
    if (typeof selector === 'function') {
      return selector({ actorState: 'authenticated' as const })
    }
    return { actorState: 'authenticated' as const }
  })
}

function mockAnonymous() {
  mockUseAuthStore.mockImplementation((selector: any) => {
    if (typeof selector === 'function') {
      return selector({ actorState: 'anonymous' as const })
    }
    return { actorState: 'anonymous' as const }
  })
}

const mockConnection = {
  id: 1,
  name: 'Test MCP',
  installationId: 10,
  enabled: true,
  installation: { namespaceKey: 'test-server' },
}

const mockConnection2 = {
  id: 2,
  name: 'Another MCP',
  installationId: 11,
  enabled: true,
  installation: { namespaceKey: 'another-server' },
}

const mockBinding = {
  id: 100,
  connectionId: 1,
  scopeType: 'session',
  scopeId: '42',
  enabled: true,
}

const mockToolView = {
  id: 1,
  connectionId: 1,
  originalName: 'test_tool',
  description: 'A test tool',
  pinned: true,
}

describe('useMcpSessionBindings', () => {
  const defaultSettings = { mcpGlobalEnabled: true }

  beforeEach(() => {
    vi.clearAllMocks()
    mockListConnections.mockReset()
    mockListBindings.mockReset()
    mockListSessionTools.mockReset()
    mockCreateBinding.mockReset()
    mockUpdateBinding.mockReset()
    mockAuthenticated()
  })

  it('未登录时不调用 API', () => {
    mockAnonymous()
    const { result } = renderHook(() => useMcpSessionBindings(42, defaultSettings))

    expect(mockListConnections).not.toHaveBeenCalled()
    expect(mockListBindings).not.toHaveBeenCalled()
    expect(mockListSessionTools).not.toHaveBeenCalled()
    expect(result.current.connectionOptions).toEqual([])
    expect(result.current.sessionTools).toEqual([])
  })

  it('无 session 时不调用 API', () => {
    const { result } = renderHook(() => useMcpSessionBindings(null, defaultSettings))

    expect(mockListConnections).not.toHaveBeenCalled()
    expect(result.current.connectionOptions).toEqual([])
  })

  it('全局关闭时不调用 API', () => {
    const { result } = renderHook(() => useMcpSessionBindings(42, { mcpGlobalEnabled: false }))

    expect(mockListConnections).not.toHaveBeenCalled()
    expect(result.current.mcpGlobalEnabled).toBe(false)
  })

  it('登录有 session 时加载 connections/bindings/tools', async () => {
    mockListConnections.mockResolvedValue({ data: [mockConnection] })
    mockListBindings.mockResolvedValue({ data: [mockBinding] })
    mockListSessionTools.mockResolvedValue({ data: [mockToolView] })

    const { result } = renderHook(() => useMcpSessionBindings(42, defaultSettings))

    // Wait for the async effect to complete
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(mockListConnections).toHaveBeenCalledWith({ mine: true })
    expect(mockListBindings).toHaveBeenCalledWith({ scopeType: 'session', scopeId: '42' })
    expect(mockListSessionTools).toHaveBeenCalledWith(42)

    expect(result.current.connectionOptions).toHaveLength(1)
    expect(result.current.connectionOptions[0].connectionName).toBe('Test MCP')
    expect(result.current.connectionOptions[0].enabled).toBe(true)
    expect(result.current.connectionOptions[0].bindingId).toBe(100)
    expect(result.current.sessionTools).toHaveLength(1)
  })

  it('toggle 已存在的绑定调用 PATCH', async () => {
    mockListConnections.mockResolvedValue({ data: [mockConnection] })
    mockListBindings.mockResolvedValue({ data: [mockBinding] })
    mockListSessionTools.mockResolvedValue({ data: [] })
    mockUpdateBinding.mockResolvedValue({ data: { id: 100, enabled: false } })
    mockListSessionTools.mockResolvedValue({ data: [] })

    const { result } = await waitFor(() => {
      const hook = renderHook(() => useMcpSessionBindings(42, defaultSettings))
      return hook
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.toggleBinding(1, false)
    })

    expect(mockUpdateBinding).toHaveBeenCalledWith(100, { enabled: false })
    expect(result.current.connectionOptions[0].enabled).toBe(false)
  })

  it('toggle 新绑定调用 POST', async () => {
    mockListConnections.mockResolvedValue({ data: [mockConnection] })
    mockListBindings.mockResolvedValue({ data: [] }) // no existing binding
    mockListSessionTools.mockResolvedValue({ data: [] })
    mockCreateBinding.mockResolvedValue({ data: { id: 200, enabled: true } })
    mockListSessionTools.mockResolvedValue({ data: [] })

    const { result } = await waitFor(() => {
      const hook = renderHook(() => useMcpSessionBindings(42, defaultSettings))
      return hook
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.toggleBinding(1, true)
    })

    expect(mockCreateBinding).toHaveBeenCalledWith({
      connectionId: 1,
      scopeType: 'session',
      scopeId: '42',
      enabled: true,
    })
    expect(result.current.connectionOptions[0].enabled).toBe(true)
  })

  it('toggle 失败后回滚', async () => {
    mockListConnections.mockResolvedValue({ data: [mockConnection] })
    mockListBindings.mockResolvedValue({ data: [mockBinding] }) // has binding, enabled=true
    mockListSessionTools.mockResolvedValue({ data: [] })
    mockUpdateBinding.mockRejectedValue(new Error('Network error'))

    let hookResult: any

    await waitFor(() => {
      const hook = renderHook(() => useMcpSessionBindings(42, defaultSettings))
      hookResult = hook
      return undefined
    })

    await waitFor(() => expect(hookResult.result.current.loading).toBe(false))

    // Initial state: enabled=true
    expect(hookResult.result.current.connectionOptions[0].enabled).toBe(true)

    await act(async () => {
      await hookResult.result.current.toggleBinding(1, false)
    })

    // After failure: should revert to original enabled=true
    expect(hookResult.result.current.connectionOptions[0].enabled).toBe(true)
    expect(mockUpdateBinding).toHaveBeenCalledWith(100, { enabled: false })
  })
})
