import React from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { SettingsLayoutClient } from "@/app/main/settings/_components/settings-layout-client"
import { SystemModelsPage } from '@/features/settings/pages/system-models'
import type { SystemSettings } from '@/types'
import {
  adminAuthState,
  baseSettings,
  sampleModelList,
  userAuthState,
} from './system-settings-pages.fixtures'

type MockSystemSettingsResult = {
  settings: SystemSettings | null
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
  update: (payload: Partial<SystemSettings>) => Promise<void>
  clearError: () => void
}

const useSystemSettingsMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-system-settings", () => ({
  useSystemSettings: useSystemSettingsMock,
}))

const useSystemModelsMock = vi.hoisted(() => vi.fn())
vi.mock("@/components/settings/system-models/use-system-models", () => ({
  useSystemModels: () => useSystemModelsMock(),
}))

const useAuthStoreMock = vi.hoisted(() => vi.fn())
vi.mock("@/store/auth-store", () => ({
  useAuthStore: useAuthStoreMock,
}))

const toastSpy = vi.hoisted(() => vi.fn())
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
  toast: toastSpy,
}))

const routerPush = vi.fn()
const routerReplace = vi.fn()
const pathnameMock = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
  usePathname: () => pathnameMock(),
}))

vi.mock('@/features/settings/api', () => ({
  syncAnonymousQuota: vi.fn(),
  refreshImageAttachments: vi.fn(),
}))

vi.mock('@/features/system/api', () => ({
  getTaskTraces: vi.fn().mockResolvedValue({ data: { total: 0 } }),
  cleanupTaskTraces: vi.fn().mockResolvedValue({ data: { deleted: 0 } }),
}))

const refreshSpy = vi.fn<[], Promise<void>>(() => Promise.resolve())
const updateSpy = vi.fn<[Partial<SystemSettings>], Promise<void>>(() => Promise.resolve())

const mockUseAuthStore = (state: typeof adminAuthState | typeof userAuthState) => {
  useAuthStoreMock.mockImplementation((selector: any) => {
    if (typeof selector === "function") return selector(state)
    return state
  })
}

const mockSystemSettings = (
  settings: SystemSettings | null,
  extras: Partial<MockSystemSettingsResult> = {}
) => {
  const payload: MockSystemSettingsResult = {
    settings,
    isLoading: false,
    error: null,
    refresh: refreshSpy,
    update: updateSpy,
    clearError: vi.fn(),
    ...extras,
  }
  useSystemSettingsMock.mockReturnValue(payload)
}

const mockSystemModels = (overrides: Record<string, any> = {}) => {
  const defaultState = {
    list: sampleModelList,
    isLoading: false,
    q: "",
    setQ: vi.fn(),
    onlyOverridden: false,
    setOnlyOverridden: vi.fn(),
    sortField: "name",
    sortOrder: "asc",
    toggleSort: vi.fn(),
    selectedKeys: new Set<string>(),
    toggleSelectAll: vi.fn(),
    toggleSelectRow: vi.fn(),
    clearSelection: vi.fn(),
    savingKey: "",
    refreshing: false,
    manualRefresh: vi.fn(),
    reload: vi.fn(),
    clearDialogOpen: false,
    setClearDialogOpen: vi.fn(),
    clearing: false,
    handleClearAll: vi.fn(),
    handleExport: vi.fn(),
    handleImportFile: vi.fn(),
    handleToggleCapability: vi.fn(),
    handleSaveMaxTokens: vi.fn(),
    resetModel: vi.fn(),
    handleBatchReset: vi.fn(),
    hasCapability: (model: any, key: string) => Boolean(model?.capabilities?.[key]),
    recommendTag: () => "推荐:通用对话",
    bulkUpdateCapability: vi.fn(),
    batchUpdating: false,
    ...overrides,
  }
  useSystemModelsMock.mockReturnValue(defaultState)
  return defaultState
}

beforeEach(() => {
  vi.clearAllMocks()
  refreshSpy.mockClear()
  updateSpy.mockClear()
  mockUseAuthStore(adminAuthState)
  pathnameMock.mockReturnValue("/main/settings/system/general")
  mockSystemSettings(baseSettings)
})

afterEach(() => {
  cleanup()
})

describe("权限与导航", () => {
  test("非管理员访问系统设置会跳转到个人设置", () => {
    mockUseAuthStore(userAuthState)
    pathnameMock.mockReturnValue("/main/settings/system/network")

    render(
      <SettingsLayoutClient>
        <div data-testid="settings-content" />
      </SettingsLayoutClient>
    )

    expect(screen.getByText("当前账户无权访问系统设置，正在跳转到个人设置…")).toBeInTheDocument()
    expect(routerReplace).toHaveBeenCalledWith("/main/settings/personal")
  })
})

// 被新页吸收的旧页面（SystemGeneralPage/SystemNetworkPage/SystemReasoningPage/
// SystemWebSearchPage 等）的测试已由新页测试承接（branding/users-registration/
// tools-extensions/data-maintenance/reasoning-network/search-knowledge 等）。

describe("视图快照", () => {
  test("SystemModelsPage 渲染保持稳定", () => {
    mockSystemModels()
    const { container } = render(<SystemModelsPage />)
    expect(container).toMatchSnapshot()
  })
})
