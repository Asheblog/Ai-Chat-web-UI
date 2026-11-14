import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WelcomeScreen } from '@/components/welcome-screen'
import { getAggregatedModels } from '@/features/system/api'
import { useAuthStore } from '@/store/auth-store'
import { useModelsStore, type ModelItem } from '@/store/models-store'
import { useModelPreferenceStore } from '@/store/model-preference-store'
import { useSettingsStore } from '@/store/settings-store'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/components/user-menu', () => ({ UserMenu: () => null }))
vi.mock('@/features/system/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/system/api')>(),
  getAggregatedModels: vi.fn(),
}))

const recoveredModel: ModelItem = {
  id: 'gpt-4.1', rawId: 'gpt-4.1', name: '工作区恢复模型', provider: 'openai',
  channelName: '工作区主连接', connectionId: 31, connectionBaseUrl: 'https://fixture.invalid',
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.clearAllMocks()
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Element.prototype.scrollIntoView = vi.fn()
  useModelPreferenceStore.getState().clear()
  useModelsStore.setState({ models: [], isLoading: false, error: null })
  useAuthStore.setState({ actor: null, user: null, actorState: 'anonymous', quota: null })
  useSettingsStore.setState({ systemSettings: null, publicBrandText: 'AIChat' })
  vi.mocked(getAggregatedModels).mockResolvedValue({ success: true, data: [recoveredModel] })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Welcome model discovery recovery', () => {
  it('opens an empty model directory while send remains disabled and can refresh it', async () => {
    const user = userEvent.setup()
    render(<WelcomeScreen />)
    const send = screen.getByRole('button', { name: /^发送$/ })
    expect(send).toBeDisabled()
    const trigger = screen.getByRole('combobox', { name: '选择模型' })
    expect(trigger).toBeEnabled()
    await user.click(trigger)
    expect(await screen.findByText('暂无可用模型')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '刷新模型目录' }))
    await waitFor(() => expect(trigger).toHaveTextContent('工作区恢复模型'))
    expect(send).toBeEnabled()
    expect(getAggregatedModels).toHaveBeenCalledTimes(1)
  })

  it('opens the first-load error and retries successfully without enabling send before recovery', async () => {
    vi.mocked(getAggregatedModels).mockRejectedValueOnce(new Error('首次模型请求失败'))
    await useModelsStore.getState().fetchAll()
    const user = userEvent.setup()
    render(<WelcomeScreen />)
    const send = screen.getByRole('button', { name: /^发送$/ })
    expect(send).toBeDisabled()
    const trigger = screen.getByRole('combobox', { name: '选择模型' })
    expect(trigger).toBeEnabled()
    await user.click(trigger)
    expect(await screen.findByRole('alert')).toHaveTextContent('首次模型请求失败')
    await user.click(screen.getByRole('button', { name: /^重试$/ }))
    await waitFor(() => expect(trigger).toHaveTextContent('工作区恢复模型'))
    expect(send).toBeEnabled()
    expect(getAggregatedModels).toHaveBeenCalledTimes(2)
  })

  it('lets an exhausted anonymous user browse models without enabling send', async () => {
    useModelsStore.setState({ models: [recoveredModel] })
    useAuthStore.setState({ quota: {
      scope: 'ANON', identifier: 'welcome-recovery-fixture', dailyLimit: 1, usedCount: 1, remaining: 0,
      lastResetAt: '2026-11-14T00:00:00.000Z', unlimited: false, customDailyLimit: null, usingDefaultLimit: true,
    } })
    const user = userEvent.setup()
    render(<WelcomeScreen />)
    const trigger = screen.getByRole('combobox', { name: '选择模型' })
    expect(trigger).toBeEnabled()
    expect(screen.getByRole('button', { name: /^发送$/ })).toBeDisabled()
    await user.click(trigger)
    expect(await screen.findByRole('textbox', { name: '搜索模型或供应商' })).toBeVisible()
  })
})
