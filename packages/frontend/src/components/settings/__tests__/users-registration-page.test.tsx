import React from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { UsersRegistrationPage } from "@/components/settings/pages/users-registration/UsersRegistrationPage"
import { adminAuthState, baseSettings } from "./system-settings-pages.fixtures"

// jsdom 未实现 Pointer Capture API，Radix Select/AlertDialog 依赖它
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

const useSystemSettingsMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-system-settings", () => ({
  useSystemSettings: useSystemSettingsMock,
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

const syncAnonymousQuotaMock = vi.hoisted(() => vi.fn())
vi.mock("@/features/settings/api", () => ({
  syncAnonymousQuota: syncAnonymousQuotaMock,
}))

const useSystemUsersMock = vi.hoisted(() => vi.fn())
vi.mock("@/components/settings/system-users/use-system-users", () => ({
  useSystemUsers: () => useSystemUsersMock(),
}))

const refreshSpy = vi.fn<[], Promise<void>>(() => Promise.resolve())
const updateSpy = vi.fn<[Partial<typeof baseSettings>], Promise<void>>(() => Promise.resolve())

const mockSystemSettings = (
  settings: typeof baseSettings | null,
  extras: Partial<{ isLoading: boolean; error: string | null }> = {},
) => {
  useSystemSettingsMock.mockReturnValue({
    settings,
    isLoading: false,
    error: null,
    refresh: refreshSpy,
    update: updateSpy,
    clearError: vi.fn(),
    ...extras,
  })
}

const mockUseAuthStore = (state: typeof adminAuthState) => {
  useAuthStoreMock.mockImplementation((selector: any) => {
    if (typeof selector === "function") return selector(state)
    return state
  })
}

/** SystemUsersPage 整组件渲染期使用的 hook 状态（与 useSystemUsers 返回 key 对齐） */
const mockSystemUsers = (overrides: Record<string, any> = {}) => {
  const rows = [
    {
      id: 1,
      username: "alice",
      role: "ADMIN",
      status: "ACTIVE",
      createdAt: "2026-07-01T00:00:00.000Z",
      approvedAt: null,
      approvedById: null,
      rejectedAt: null,
      rejectedById: null,
      rejectionReason: null,
    },
    {
      id: 2,
      username: "bob",
      role: "USER",
      status: "PENDING",
      createdAt: "2026-07-02T00:00:00.000Z",
      approvedAt: null,
      approvedById: null,
      rejectedAt: null,
      rejectedById: null,
      rejectionReason: null,
    },
  ]
  const defaultState = {
    loading: false,
    error: null,
    rows,
    sortedRows: rows,
    pagination: { page: 1, limit: 10, totalPages: 1 },
    search: "",
    searchDraft: "",
    setSearchDraft: vi.fn(),
    statusFilter: "ALL",
    sortField: "createdAt",
    sortOrder: "desc",
    selectedIds: new Set<number>(),
    quotaDialogOpen: false,
    quotaTarget: null,
    quotaSnapshot: null,
    quotaLoading: false,
    quotaSubmitting: false,
    quotaError: null,
    quotaForm: { useDefault: true, dailyLimit: "", resetUsed: false },
    decisionDialog: {
      open: false,
      mode: "REJECT",
      target: null,
      reason: "",
      submitting: false,
      error: null,
    },
    confirmState: { open: false, mode: null, target: null, role: undefined },
    confirmLoading: false,
    confirmMeta: null,
    actionUserId: null,
    refresh: vi.fn(),
    onSearch: vi.fn(),
    onClearSearch: vi.fn(),
    handleStatusFilterChange: vi.fn(),
    toggleSort: vi.fn(),
    toggleSelectAll: vi.fn(),
    toggleSelectRow: vi.fn(),
    handleBatchEnable: vi.fn(),
    handleBatchDisable: vi.fn(),
    handleBatchDelete: vi.fn(),
    clearSelection: vi.fn(),
    openQuotaDialog: vi.fn(),
    handleQuotaDialogOpenChange: vi.fn(),
    setQuotaForm: vi.fn(),
    handleQuotaSave: vi.fn(),
    openDecisionDialog: vi.fn(),
    closeDecisionDialog: vi.fn(),
    submitDecisionDialog: vi.fn(),
    updateDecisionReason: vi.fn(),
    confirmApprove: vi.fn(),
    confirmEnable: vi.fn(),
    confirmChangeRole: vi.fn(),
    confirmDelete: vi.fn(),
    closeConfirm: vi.fn(),
    runConfirmAction: vi.fn(),
    changePageSize: vi.fn(),
    goToPage: vi.fn(),
    ...overrides,
  }
  useSystemUsersMock.mockReturnValue(defaultState)
  return defaultState
}

/** 通过卡片标题定位 FeatureCard 的 <section> 根节点 */
const getCard = (title: string) => {
  const heading = screen.getByText(title)
  const section = heading.closest("section")
  if (!section) throw new Error(`未找到卡片容器: ${title}`)
  return section as HTMLElement
}

beforeEach(() => {
  vi.clearAllMocks()
  refreshSpy.mockClear()
  updateSpy.mockClear()
  syncAnonymousQuotaMock.mockResolvedValue({})
  mockUseAuthStore(adminAuthState)
  mockSystemSettings(baseSettings)
  mockSystemUsers()
})

afterEach(() => {
  cleanup()
})

describe("UsersRegistrationPage", () => {
  test("渲染页头「用户与注册」+「用户注册」卡 +「用户管理」分区标题", () => {
    render(<UsersRegistrationPage />)

    expect(screen.getByText("用户与注册")).toBeInTheDocument()
    expect(screen.getByText("注册开放策略、每日额度与用户管理")).toBeInTheDocument()
    // 注册策略 FeatureCard
    expect(screen.getByText("用户注册")).toBeInTheDocument()
    expect(screen.getByText("控制新用户的注册和访客访问")).toBeInTheDocument()
    // 分区二标题 + 内嵌 SystemUsersPage 自带页头 → 至少 2 处
    expect(screen.getAllByText("用户管理").length).toBeGreaterThanOrEqual(2)
    // 三行设置项
    expect(screen.getByText("开放用户注册")).toBeInTheDocument()
    expect(screen.getByText("匿名访客每日额度")).toBeInTheDocument()
    expect(screen.getByText("注册用户默认每日额度")).toBeInTheDocument()
  })

  test("注册卡保存 payload 精确等于 3 个 key（allowRegistration/anonymousDailyQuota/defaultUserDailyQuota）", async () => {
    render(<UsersRegistrationPage />)
    const card = getCard("用户注册")

    // 修改匿名额度 5 → 12 后保存
    fireEvent.change(within(card).getByDisplayValue("5"), { target: { value: "12" } })
    await userEvent.click(within(card).getByRole("button", { name: "保存注册策略" }))

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1)
    })
    const payload = updateSpy.mock.calls[0][0] as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual(
      ["allowRegistration", "anonymousDailyQuota", "defaultUserDailyQuota"].sort(),
    )
    expect(payload).toEqual({
      allowRegistration: true,
      anonymousDailyQuota: 12,
      defaultUserDailyQuota: 50,
    })
  })

  test("anonymousDailyQuota=-1 阻止保存并 toast「输入无效」", async () => {
    render(<UsersRegistrationPage />)
    const card = getCard("用户注册")

    fireEvent.change(within(card).getByDisplayValue("5"), { target: { value: "-1" } })
    await userEvent.click(within(card).getByRole("button", { name: "保存注册策略" }))

    expect(updateSpy).not.toHaveBeenCalled()
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "输入无效", variant: "destructive" }),
    )
  })

  test("同步按钮打开确认对话框，确认后调用 syncAnonymousQuota({ resetUsed: true })", async () => {
    render(<UsersRegistrationPage />)
    const card = getCard("用户注册")

    await userEvent.click(within(card).getByRole("button", { name: "同步" }))

    expect(await screen.findByText("确认同步匿名访客额度？")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "确认同步" }))

    await waitFor(() => {
      expect(syncAnonymousQuotaMock).toHaveBeenCalledWith({ resetUsed: true })
    })
  })

  test("用户管理区渲染 mock 用户数据行", () => {
    render(<UsersRegistrationPage />)

    expect(screen.getByText("alice")).toBeInTheDocument()
    expect(screen.getByText("bob")).toBeInTheDocument()
    expect(screen.getByText("用户列表")).toBeInTheDocument()
  })

  test("settings 加载中渲染骨架，不崩溃", () => {
    mockSystemSettings(null, { isLoading: true })
    const { container } = render(<UsersRegistrationPage />)

    expect(container.querySelector(".animate-pulse")).not.toBeNull()
    expect(screen.queryByRole("button", { name: "保存注册策略" })).not.toBeInTheDocument()
    expect(screen.queryByText("alice")).not.toBeInTheDocument()
  })
})
