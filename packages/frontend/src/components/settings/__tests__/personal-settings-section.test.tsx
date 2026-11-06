import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PersonalSettings } from '@/components/personal-settings'

const toastSpy = vi.hoisted(() => vi.fn())
vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: toastSpy }),
  toast: toastSpy,
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', resolvedTheme: 'light', setTheme: vi.fn() }),
}))

const settingsStoreMock = vi.hoisted(() => ({
  contextEnabled: true,
  newConversationContextEnabled: false,
  setContextEnabled: vi.fn(),
  setNewConversationContextEnabled: vi.fn(),
}))
vi.mock('@/store/settings-store', () => ({
  useSettingsStore: () => settingsStoreMock,
}))

const authState = vi.hoisted(() => ({
  user: { username: 'tester', avatarUrl: null, personalPrompt: null },
  actorState: 'authenticated',
  fetchActor: vi.fn(),
}))
vi.mock('@/store/auth-store', () => ({
  useAuthStore: (selector: any) => (typeof selector === 'function' ? selector(authState) : authState),
}))

const settingsApiMocks = vi.hoisted(() => ({ updatePersonalSettings: vi.fn() }))
vi.mock('@/features/settings/api', () => ({
  updatePersonalSettings: settingsApiMocks.updatePersonalSettings,
}))

const shareApiMocks = vi.hoisted(() => ({
  listChatShares: vi.fn().mockResolvedValue({ success: true, data: { shares: [] } }),
  revokeChatShare: vi.fn(),
  updateChatShare: vi.fn(),
}))
vi.mock('@/features/share/api', () => shareApiMocks)

const skillsApiMocks = vi.hoisted(() => ({
  listSkillStore: vi.fn().mockResolvedValue({ success: true, data: { items: [], sources: [] } }),
  listSkillCatalog: vi.fn().mockResolvedValue({ success: true, data: [] }),
  installSkillFromStore: vi.fn(),
  deleteSkill: vi.fn(),
}))
vi.mock('@/features/skills/api', () => skillsApiMocks)

vi.mock('@/features/auth/api', () => ({ changePassword: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('PersonalSettings 按激活页挂载', () => {
  it('profile 只挂载个人资料，不请求 Skills/分享列表', async () => {
    const { container } = render(<PersonalSettings activeSection="profile" />)

    await waitFor(
      () => {
        expect(screen.getByText('管理你的头像、用户名与界面主题')).toBeInTheDocument()
      },
      { timeout: 4000 },
    )
    expect(container.querySelector('#settings-personal-preferences')).not.toBeNull()
    expect(container.querySelector('#settings-personal-skills')).toBeNull()
    expect(container.querySelector('#settings-share-management')).toBeNull()
    expect(container.querySelector('#settings-personal-security')).toBeNull()
    expect(skillsApiMocks.listSkillStore).not.toHaveBeenCalled()
    expect(shareApiMocks.listChatShares).not.toHaveBeenCalled()
  })

  it('skills 只挂载个人 Skills 叶子', async () => {
    const { container } = render(<PersonalSettings activeSection="skills" />)

    await waitFor(() => {
      expect(screen.getByText('个人 Skills')).toBeInTheDocument()
    })
    expect(container.querySelector('#settings-personal-skills')).not.toBeNull()
    expect(container.querySelector('#settings-personal-preferences')).toBeNull()
    expect(shareApiMocks.listChatShares).not.toHaveBeenCalled()
  })

  it('切换 shares 后才请求分享列表', async () => {
    const view = render(<PersonalSettings activeSection="profile" />)
    await waitFor(() => {
      expect(screen.getByText('管理你的头像、用户名与界面主题')).toBeInTheDocument()
    })
    expect(shareApiMocks.listChatShares).not.toHaveBeenCalled()

    view.rerender(<PersonalSettings activeSection="shares" />)

    await waitFor(
      () => {
        expect(shareApiMocks.listChatShares).toHaveBeenCalledTimes(1)
      },
      { timeout: 4000 },
    )
    expect(screen.getByText('最近分享')).toBeInTheDocument()
  })
})

describe('个人设置 hash 导航协议', () => {
  it('hash 可解析为四个页签，未知 hash 回退 null', async () => {
    const { resolvePersonalSectionFromHash } = await import('@/components/settings/personal-section')
    expect(resolvePersonalSectionFromHash('#settings-personal-preferences')).toBe('profile')
    expect(resolvePersonalSectionFromHash('#settings-personal-skills')).toBe('skills')
    expect(resolvePersonalSectionFromHash('#settings-share-management')).toBe('shares')
    expect(resolvePersonalSectionFromHash('#settings-personal-security')).toBe('security')
    expect(resolvePersonalSectionFromHash('#unknown')).toBeNull()
  })

  it('setPersonalSection 写入 hash 并触发导航事件', async () => {
    const { setPersonalSection } = await import('@/components/settings/personal-section')
    const listener = vi.fn()
    window.addEventListener('aichat:personal-section', listener)
    window.history.replaceState({}, '', '/main/settings/personal')

    act(() => {
      setPersonalSection('shares')
    })

    expect(window.location.hash).toBe('#settings-share-management')
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener('aichat:personal-section', listener)
  })

  it('hashchange 与 popstate 可回放四个页签（back/forward）', async () => {
    const { usePersonalSectionFromHash } = await import('@/components/settings/personal-section')
    const { renderHook, act: hookAct } = await import('@testing-library/react')

    window.history.replaceState({}, '', '/main/settings/personal#settings-personal-preferences')

    const { result } = renderHook(() => usePersonalSectionFromHash())
    expect(result.current).toBe('profile')

    hookAct(() => {
      window.history.pushState({}, '', '/main/settings/personal#settings-personal-skills')
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(result.current).toBe('skills')

    hookAct(() => {
      window.history.pushState({}, '', '/main/settings/personal#settings-personal-security')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(result.current).toBe('security')
  })
})
