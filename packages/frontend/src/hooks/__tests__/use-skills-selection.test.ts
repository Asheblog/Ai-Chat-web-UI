import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSkillsSelection } from '@/hooks/use-skills-selection'

const mockListSkillCatalog = vi.fn()
const mockListSessionSkillOptions = vi.fn()
const mockUpdateSessionSkillBinding = vi.fn()

vi.mock('@/features/skills/api', () => ({
  listSkillCatalog: (...args: any[]) => mockListSkillCatalog(...args),
  listSessionSkillOptions: (...args: any[]) => mockListSessionSkillOptions(...args),
  updateSessionSkillBinding: (...args: any[]) => mockUpdateSessionSkillBinding(...args),
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

const userPrivateSkill = {
  id: 10,
  slug: 'my-private-skill',
  displayName: 'My Private Skill',
  description: 'A test skill',
  visibility: 'user_private' as const,
  status: 'active' as const,
  defaultVersion: { id: 5, version: '1.0.0', status: 'active' },
  sourceKey: 'github',
  licenseName: 'MIT',
}

const builtinSkill = {
  id: 20,
  slug: 'builtin-skill',
  displayName: 'Builtin Skill',
  visibility: 'system' as const,
  status: 'active' as const,
  defaultVersion: { id: 6, version: '2.0.0', status: 'active' },
}

const noDefaultVersionSkill = {
  id: 30,
  slug: 'no-default',
  displayName: 'No Default',
  visibility: 'user_private' as const,
  status: 'active' as const,
  defaultVersion: null,
}

describe('useSkillsSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListSkillCatalog.mockReset()
    mockListSessionSkillOptions.mockReset()
    mockUpdateSessionSkillBinding.mockReset()
    mockAuthenticated()
  })

  // ============================================================
  // Draft mode (sessionId = null, undefined)
  // ============================================================

  it('draft mode: loads user_private active skills with defaultVersion as candidates', async () => {
    mockListSkillCatalog.mockResolvedValue({
      success: true,
      data: [userPrivateSkill, builtinSkill, noDefaultVersionSkill],
    })

    const { result } = renderHook(() => useSkillsSelection(null))

    await waitFor(() => {
      expect(result.current.skillOptions.length).toBeGreaterThan(0)
    })

    // 普通用户不应传管理员参数 all/includeVersions，否则后端返回 403
    expect(mockListSkillCatalog).toHaveBeenCalledTimes(1)
    expect(mockListSkillCatalog).toHaveBeenCalledWith()

    // 只应包含 user_private + active + 有 defaultVersion 的 skill
    const options = result.current.skillOptions
    expect(options).toHaveLength(1)
    expect(options[0].skillId).toBe(10)
    expect(options[0].slug).toBe('my-private-skill')
    expect(options[0].label).toBe('My Private Skill')
    expect(options[0].versionId).toBe(5)
    expect(options[0].enabled).toBe(false)

    // builtin skill 不应出现，noDefaultVersion 也不应出现
    expect(options.find((o) => o.skillId === 20)).toBeUndefined()
    expect(options.find((o) => o.skillId === 30)).toBeUndefined()
  })

  it('draft mode: toggleSkillOption updates local state only, no API call', async () => {
    mockListSkillCatalog.mockResolvedValue({
      success: true,
      data: [userPrivateSkill],
    })

    const { result } = renderHook(() => useSkillsSelection(null))

    await waitFor(() => {
      expect(result.current.skillOptions.length).toBe(1)
    })

    expect(result.current.skillOptions[0].enabled).toBe(false)

    await act(async () => {
      await result.current.toggleSkillOption(10, true)
    })

    expect(result.current.skillOptions[0].enabled).toBe(true)
    expect(mockUpdateSessionSkillBinding).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.toggleSkillOption(10, false)
    })

    expect(result.current.skillOptions[0].enabled).toBe(false)
    expect(mockUpdateSessionSkillBinding).not.toHaveBeenCalled()
  })

  it('draft mode: enabledExtraSkills reflects toggled state', async () => {
    mockListSkillCatalog.mockResolvedValue({
      success: true,
      data: [userPrivateSkill],
    })

    const { result } = renderHook(() => useSkillsSelection(null))

    await waitFor(() => {
      expect(result.current.skillOptions.length).toBe(1)
    })

    expect(result.current.enabledExtraSkills).toHaveLength(0)

    await act(async () => {
      await result.current.toggleSkillOption(10, true)
    })

    expect(result.current.enabledExtraSkills).toHaveLength(1)
    expect(result.current.enabledExtraSkills[0]).toEqual({
      skillId: 10,
      versionId: 5,
    })
  })

  it('draft mode: catalog API error results in empty list', async () => {
    mockListSkillCatalog.mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useSkillsSelection(null))

    await waitFor(() => {
      expect(result.current.skillOptions).toHaveLength(0)
    })

    expect(result.current.skillOptions).toEqual([])
  })

  // ============================================================
  // Anonymous user
  // ============================================================

  it('anonymous user: does not load any skills in draft mode', async () => {
    mockAnonymous()

    const { result } = renderHook(() => useSkillsSelection(null))

    expect(result.current.canUsePrivateSkills).toBe(false)
    expect(result.current.skillOptions).toHaveLength(0)
    expect(mockListSkillCatalog).not.toHaveBeenCalled()
  })

  // ============================================================
  // Session mode (sessionId is set) — existing behavior regression guard
  // ============================================================

  it('session mode: loads skills from session-options API', async () => {
    mockListSessionSkillOptions.mockResolvedValue({
      success: true,
      data: {
        items: [
          {
            id: 10,
            slug: 'my-skill',
            displayName: 'My Skill',
            defaultVersion: { id: 5, version: '1.0.0', status: 'active' },
            sessionBinding: { id: 1, enabled: true, versionId: 5 },
          },
        ],
      },
    })

    const { result } = renderHook(() => useSkillsSelection(123))

    await waitFor(() => {
      expect(result.current.skillOptions.length).toBe(1)
    })

    expect(mockListSessionSkillOptions).toHaveBeenCalledWith(123)
    expect(result.current.skillOptions[0].enabled).toBe(true)
    expect(result.current.canUsePrivateSkills).toBe(true)
  })

  it('session mode: toggleSkillOption calls updateSessionSkillBinding', async () => {
    mockListSessionSkillOptions.mockResolvedValue({
      success: true,
      data: {
        items: [
          {
            id: 10,
            slug: 'my-skill',
            displayName: 'My Skill',
            defaultVersion: { id: 5, version: '1.0.0', status: 'active' },
            sessionBinding: { id: 1, enabled: true, versionId: 5 },
          },
        ],
      },
    })
    mockUpdateSessionSkillBinding.mockResolvedValue({ success: true })

    const { result } = renderHook(() => useSkillsSelection(123))

    await waitFor(() => {
      expect(result.current.skillOptions.length).toBe(1)
    })
    expect(result.current.skillOptions[0].enabled).toBe(true)

    await act(async () => {
      await result.current.toggleSkillOption(10, false)
    })

    expect(mockUpdateSessionSkillBinding).toHaveBeenCalledWith(123, {
      skillId: 10,
      versionId: 5,
      enabled: false,
    })
    expect(result.current.skillOptions[0].enabled).toBe(false)
  })

  it('session mode: toggle rollback on API failure', async () => {
    mockListSessionSkillOptions.mockResolvedValue({
      success: true,
      data: {
        items: [
          {
            id: 10,
            slug: 'my-skill',
            displayName: 'My Skill',
            defaultVersion: { id: 5, version: '1.0.0', status: 'active' },
            sessionBinding: { id: 1, enabled: false, versionId: 5 },
          },
        ],
      },
    })
    mockUpdateSessionSkillBinding.mockRejectedValue(new Error('fail'))

    const { result } = renderHook(() => useSkillsSelection(123))

    await waitFor(() => {
      expect(result.current.skillOptions.length).toBe(1)
    })
    expect(result.current.skillOptions[0].enabled).toBe(false)

    await act(async () => {
      await result.current.toggleSkillOption(10, true)
    })

    // 应回滚到 false
    expect(result.current.skillOptions[0].enabled).toBe(false)
  })
})
