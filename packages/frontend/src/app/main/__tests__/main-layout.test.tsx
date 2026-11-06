import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '@/components/app-shell'
import MainLayout from '../layout'
import { useAuthStore } from '@/store/auth-store'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/main',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({ setTheme: vi.fn() }),
}))

vi.mock('@/components/sidebar', () => ({
  Sidebar: () => <aside data-testid="sidebar-ready">侧栏</aside>,
}))

vi.mock('@/components/model-selector', () => ({
  ModelSelector: () => <div data-testid="model-selector" />,
}))

vi.mock('@/components/user-menu', () => ({
  UserMenu: () => <div data-testid="user-menu" />,
}))

vi.mock('@/components/skills/skill-approval-inbox', () => ({
  SkillApprovalInbox: () => <div data-testid="approval-inbox" />,
}))

vi.mock('@/components/setup-wizard/setup-wizard', () => ({
  SetupWizard: () => <div data-testid="setup-wizard" />,
}))

const bootstrapMock = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/use-main-bootstrap', () => ({ useMainBootstrap: bootstrapMock }))

const setupStatusMock = vi.hoisted(() => vi.fn())
vi.mock('@/features/setup/api', () => ({
  getSetupStatus: setupStatusMock,
  setSetupState: vi.fn(),
}))

beforeEach(async () => {
  window.localStorage.clear()
  useAuthStore.setState({
    actor: null,
    user: null,
    quota: null,
    // 静态导入已完成，此时无法再观察初始 loading；身份 loading 由 AppShell 测试单独覆盖。
    actorState: 'anonymous',
    isLoading: false,
    error: null,
  })
})

afterEach(() => {
  cleanup()
})

describe('AppShell 首屏稳定壳', () => {
  it('loading 时渲染稳定骨架而不是整页空白', () => {
    const { container } = render(
      <AppShell ready={false} sidebar={<div>侧栏</div>} toolbar={<div>工具栏</div>}>
        <div>内容</div>
      </AppShell>,
    )

    expect(container.querySelector('[data-app-shell="loading"]')).not.toBeNull()
    expect(container.firstElementChild?.className).toContain('h-screen')
    expect(screen.queryByText('内容')).not.toBeInTheDocument()
    expect(screen.queryByText('侧栏')).not.toBeInTheDocument()
  })

  it('ready 后挂载真实侧栏与内容', () => {
    render(
      <AppShell ready sidebar={<div>侧栏</div>} toolbar={<div>工具栏</div>}>
        <div>内容</div>
      </AppShell>,
    )

    expect(screen.getByText('侧栏')).toBeInTheDocument()
    expect(screen.getByText('工具栏')).toBeInTheDocument()
    expect(screen.getByText('内容')).toBeInTheDocument()
  })
})

describe('MainLayout 身份门', () => {
  it('匿名访客不加载管理员向导，保留页面内容', async () => {
    render(<MainLayout><div data-testid="page">页面</div></MainLayout>)

    await waitFor(() => expect(screen.getByTestId('approval-inbox')).toBeInTheDocument())
    expect(screen.queryByTestId('setup-wizard')).not.toBeInTheDocument()
    expect(screen.getByTestId('page')).toBeInTheDocument()
  })

  it('普通用户不加载管理员向导', async () => {
    useAuthStore.setState({
      actorState: 'authenticated',
      user: { id: 2, username: 'user', role: 'USER', createdAt: new Date().toISOString() } as never,
    })

    render(<MainLayout><div>页面</div></MainLayout>)

    await waitFor(() => expect(screen.getByTestId('approval-inbox')).toBeInTheDocument())
    expect(screen.queryByTestId('setup-wizard')).not.toBeInTheDocument()
  })

  it('管理员加载向导且页面内容同时可见', async () => {
    useAuthStore.setState({
      actorState: 'authenticated',
      user: { id: 1, username: 'admin', role: 'ADMIN', createdAt: new Date().toISOString() } as never,
    })

    render(<MainLayout><div>页面</div></MainLayout>)

    await waitFor(() => expect(screen.getByTestId('setup-wizard')).toBeInTheDocument())
    expect(screen.getByText('页面')).toBeInTheDocument()
  })
})
