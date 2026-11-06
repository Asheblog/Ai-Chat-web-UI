import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authMock = vi.hoisted(() => ({
  actorState: 'anonymous' as 'authenticated' | 'anonymous' | 'loading',
  user: null as null | { role: string },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/main',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/store/auth-store', () => ({
  useAuthStore: (selector: (state: typeof authMock) => unknown) => selector(authMock),
}))

vi.mock('@/components/skills/skill-approval-inbox', () => ({ SkillApprovalInbox: () => null }))
vi.mock('@/components/sidebar-toggle-icon', () => ({
  SidebarToggleIcon: () => null,
  SidebarCollapseIcon: () => null,
  SidebarExpandIcon: () => null,
}))

const setupStatusMock = vi.hoisted(() => vi.fn().mockResolvedValue({ data: { setup_state: 'required', requires_admin: true } }))
vi.mock('@/features/setup/api', () => ({
  getSetupStatus: setupStatusMock,
  setSetupState: vi.fn(),
}))

vi.mock('@/components/settings/pages/SystemConnections', () => ({
  SystemConnectionsPage: () => <div data-testid="system-connections" />,
}))

vi.mock('@/components/settings/settings-dialog', () => ({
  SettingsDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="settings-dialog">设置弹窗叶子</div> : null,
}))

vi.mock('@/components/settings/pages/PersonalPreferences', () => ({
  PersonalPreferencesPage: () => <div data-testid="personal-preferences" />,
}))

import { Sidebar } from '@/components/sidebar'
import { SetupWizard } from '@/components/setup-wizard/setup-wizard'

beforeEach(() => {
  authMock.actorState = 'anonymous'
  authMock.user = null
  setupStatusMock.mockClear()
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('SetupWizard 身份门', () => {
  it('匿名用户不请求 setup-status 且不打开向导', async () => {
    render(<SetupWizard />)
    await Promise.resolve()
    await Promise.resolve()

    expect(setupStatusMock).not.toHaveBeenCalled()
    expect(screen.queryByText('欢迎使用 AIChat')).not.toBeInTheDocument()
  })

  it('普通用户不请求 setup-status', async () => {
    authMock.actorState = 'authenticated'
    authMock.user = { role: 'USER' }
    render(<SetupWizard />)
    await Promise.resolve()
    await Promise.resolve()

    expect(setupStatusMock).not.toHaveBeenCalled()
  })

  it('管理员首次安装仍请求状态并打开阻塞向导', async () => {
    authMock.actorState = 'authenticated'
    authMock.user = { role: 'ADMIN' }
    render(<SetupWizard />)

    await waitFor(() => expect(setupStatusMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('欢迎使用 AIChat')).toBeInTheDocument())
  })
})

describe('Sidebar 设置懒加载', () => {
  it('首次打开设置前不挂载设置弹窗，点击后才加载', async () => {
    render(<Sidebar />)

    expect(screen.queryByTestId('settings-dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByText('设置')[0])

    await waitFor(() => expect(screen.getByTestId('settings-dialog')).toBeInTheDocument())
  })

})
