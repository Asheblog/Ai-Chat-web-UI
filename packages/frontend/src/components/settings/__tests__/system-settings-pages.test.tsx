import React from "react"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { SettingsLayoutClient } from "@/app/main/settings/_components/settings-layout-client"
import { SystemGeneralPage } from '@/features/settings/pages/system-general'
import { SystemModelsPage } from '@/features/settings/pages/system-models'
import { SystemNetworkPage } from '@/components/settings/pages/SystemNetwork'
import { SystemReasoningPage } from '@/components/settings/pages/SystemReasoning'
import { SystemWebSearchPage } from '@/components/settings/pages/SystemWebSearch'
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

describe("系统设置页面", () => {
  test("通用设置保存时会提交规范化后的有效载荷", async () => {
    const { container } = render(<SystemGeneralPage />)
    const quotaInput = container.querySelector<HTMLInputElement>("input#anonymousDailyQuota")
    const brandInput = container.querySelector<HTMLInputElement>("input#brandText")
    const saveButton = screen.getByRole("button", { name: "保存通用设置" })
    expect(quotaInput).toBeTruthy()
    expect(brandInput).toBeTruthy()

    fireEvent.change(quotaInput!, { target: { value: "15" } })
    fireEvent.change(brandInput!, { target: { value: "NewBrand" } })

    await userEvent.click(saveButton)

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({
        allowRegistration: true,
        anonymousDailyQuota: 15,
        defaultUserDailyQuota: 50,
        battleAllowAnonymous: true,
        battleAllowUsers: true,
        battleAnonymousDailyQuota: 8,
        battleUserDailyQuota: 40,
        battleRetentionDays: 15,
        brandText: "NewBrand",
        chatSystemPrompt: "",
        siteBaseUrl: "https://chat.example.com",
        chatImageRetentionDays: 30,
        assistantReplyHistoryLimit: 5,
        anonymousRetentionDays: 10,
        titleSummaryEnabled: false,
        titleSummaryMaxLength: 20,
        titleSummaryModelSource: "current",
      })
    })
  })

  test("通用设置输入非法值时会阻止更新并提示错误", async () => {
    const { container } = render(<SystemGeneralPage />)
    const quotaInput = container.querySelector<HTMLInputElement>("input#anonymousDailyQuota")
    const saveButton = screen.getByRole("button", { name: "保存通用设置" })
    fireEvent.change(quotaInput!, { target: { value: "-1" } })

    await userEvent.click(saveButton)

    expect(updateSpy).not.toHaveBeenCalled()
    expect(toastSpy).toHaveBeenCalled()
    const toastArg = toastSpy.mock.calls[0]?.[0]
    expect(toastArg?.title).toContain("输入无效")
  })

  test("乱斗保留天数非法时会阻止保存", async () => {
    const { container } = render(<SystemGeneralPage />)
    const retentionInput = container.querySelector<HTMLInputElement>("input#battleRetentionDays")
    const saveButton = screen.getByRole("button", { name: "保存通用设置" })
    fireEvent.change(retentionInput!, { target: { value: "-2" } })

    await userEvent.click(saveButton)

    expect(updateSpy).not.toHaveBeenCalled()
    expect(toastSpy).toHaveBeenCalled()
    const toastArg = toastSpy.mock.calls[0]?.[0]
    expect(toastArg?.description).toContain("乱斗历史保留天数")
  })

  test("推理链设置的自定义标签校验失败会阻断保存", async () => {
    mockSystemSettings({
      ...baseSettings,
      reasoningTagsMode: "custom",
      reasoningCustomTags: "",
    })
    render(<SystemReasoningPage />)
    const customInput = await screen.findByPlaceholderText('["<think>","</think>"]')
    fireEvent.change(customInput, { target: { value: "not-json" } })

    await userEvent.click(screen.getByRole("button", { name: "保存设置" }))

    expect(updateSpy).not.toHaveBeenCalled()
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "自定义标签无效" })
    )
  })

  test("网络与流式配置在值有效时才允许保存并调用更新", async () => {
    const { container } = render(<SystemNetworkPage />)
    const hbInput = container.querySelector<HTMLInputElement>("input#sseHeartbeat")
    const saveButton = screen.getByRole("button", { name: "保存设置" })
    expect(hbInput).toBeTruthy()

    fireEvent.change(hbInput!, { target: { value: "500" } })
    expect(saveButton).toBeDisabled()

    fireEvent.change(hbInput!, { target: { value: "20000" } })
    expect(saveButton).not.toBeDisabled()

    await userEvent.click(saveButton)

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({
        sseHeartbeatIntervalMs: 20000,
        providerMaxIdleMs: 60000,
        providerTimeoutMs: 300000,
        providerInitialGraceMs: 120000,
        providerReasoningIdleMs: 300000,
        reasoningKeepaliveIntervalMs: 0,
        usageEmit: true,
        usageProviderOnly: false,
      })
    })
  })

  test("联网搜索清除已保存 Key 后会发送清空指令", async () => {
    render(<SystemWebSearchPage />)
    const clearButtons = screen.getAllByRole("button", { name: "清除" })
    expect(clearButtons.length).toBeGreaterThan(0)
    await userEvent.click(clearButtons[0])

    const saveButton = screen.getByRole("button", { name: "保存联网搜索设置" })
    expect(saveButton).not.toBeDisabled()

    await userEvent.click(saveButton)

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          webSearchAgentEnable: true,
          webSearchDefaultEngine: "tavily",
          webSearchResultLimit: 4,
          webSearchDomainFilter: ["example.com"],
          webSearchScope: "webpage",
          webSearchIncludeSummary: false,
          webSearchIncludeRaw: false,
          webSearchApiKeyTavily: "",
        }),
      )
    })
  })
})

describe("视图快照", () => {
  test("SystemGeneralPage 渲染保持稳定", () => {
    const { container } = render(<SystemGeneralPage />)
    expect(container).toMatchSnapshot()
  })

  test("SystemModelsPage 渲染保持稳定", () => {
    mockSystemModels()
    const { container } = render(<SystemModelsPage />)
    expect(container).toMatchSnapshot()
  })
})
