import React from "react"
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { ModelsPage } from "@/components/settings/pages/models/ModelsPage"
import {
  adminAuthState,
  baseSettings,
  sampleModelList,
} from "./system-settings-pages.fixtures"

// jsdom 未实现 Pointer Capture API，Radix Select 打开菜单依赖它
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

const useSystemModelsMock = vi.hoisted(() => vi.fn())
vi.mock("@/components/settings/system-models/use-system-models", () => ({
  useSystemModels: () => useSystemModelsMock(),
}))

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

const refreshSpy = vi.fn<[], Promise<void>>(() => Promise.resolve())
const updateSpy = vi.fn<[Partial<typeof baseSettings>], Promise<void>>(() => Promise.resolve())

const mockSystemSettings = () => {
  useSystemSettingsMock.mockReturnValue({
    settings: baseSettings,
    isLoading: false,
    error: null,
    refresh: refreshSpy,
    update: updateSpy,
    clearError: vi.fn(),
  })
}

/** 复现 system-settings-pages.test.tsx 的 mockSystemModels 形态（补齐内嵌两页渲染期使用到的 key） */
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
    handleSaveContextWindow: vi.fn(),
    handleSaveTemperature: vi.fn(),
    handleUpdateAccessPolicy: vi.fn(),
    resetModel: vi.fn(),
    handleBatchReset: vi.fn(),
    hasCapability: (model: any, key: string) => Boolean(model?.capabilities?.[key]),
    recommendTag: () => "推荐:通用对话",
    bulkUpdateCapability: vi.fn(),
    bulkUpdateAccessPolicy: vi.fn(),
    batchUpdating: false,
    accessOptions: [
      { value: "inherit", label: "继承默认" },
      { value: "allow", label: "允许" },
      { value: "deny", label: "禁止" },
    ],
    ...overrides,
  }
  useSystemModelsMock.mockReturnValue(defaultState)
  return defaultState
}

const mockUseAuthStore = (state: typeof adminAuthState) => {
  useAuthStoreMock.mockImplementation((selector: any) => {
    if (typeof selector === "function") return selector(state)
    return state
  })
}

const getSection = (heading: string) => {
  const node = screen.getByRole("heading", { name: heading })
  const section = node.closest("section")
  if (!section) throw new Error(`未找到分区容器: ${heading}`)
  return section as HTMLElement
}

beforeEach(() => {
  vi.clearAllMocks()
  refreshSpy.mockClear()
  updateSpy.mockClear()
  mockUseAuthStore(adminAuthState)
  mockSystemSettings()
  mockSystemModels()
})

afterEach(() => {
  cleanup()
})

describe("ModelsPage", () => {
  test("渲染页头标题「模型管理」与两个分区标题「模型目录与能力」「访问控制」", () => {
    render(<ModelsPage />)

    // 页头标题 1 处（内嵌 SystemModelsPage 传 hideHeader 不再重复渲染自身页头）
    expect(screen.getAllByText("模型管理")).toHaveLength(1)
    expect(screen.getByText("管理模型目录、能力开关与访问控制")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "模型目录与能力" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "访问控制" })).toBeInTheDocument()
  })

  test("上分区渲染模型表格，sampleModelList 模型行可见", () => {
    render(<ModelsPage />)
    const section1 = getSection("模型目录与能力")

    expect(within(section1).getByRole("table")).toBeInTheDocument()
    expect(within(section1).getByText("GPT-4o mini")).toBeInTheDocument()
    expect(within(section1).getByText("Phi-3 Turbo")).toBeInTheDocument()
    expect(within(section1).getByText("官方 OpenAI")).toBeInTheDocument()
    expect(within(section1).getByText("Azure 生产")).toBeInTheDocument()
  })

  test("下分区渲染默认访问策略与模型访问覆写列表", () => {
    render(<ModelsPage />)
    const section2 = getSection("访问控制")

    expect(within(section2).getByText("默认访问策略")).toBeInTheDocument()
    expect(within(section2).getByText("模型访问覆写")).toBeInTheDocument()
    expect(within(section2).getByText("GPT-4o mini")).toBeInTheDocument()
    expect(within(section2).getByText("Phi-3 Turbo")).toBeInTheDocument()
  })

  test("modelsLoading 时渲染加载骨架，不崩溃", () => {
    mockSystemModels({ isLoading: true, list: [] })
    const { container } = render(<ModelsPage />)

    // 页壳与分区标题仍在
    expect(screen.getByText("管理模型目录、能力开关与访问控制")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "模型目录与能力" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "访问控制" })).toBeInTheDocument()
    // 上下分区均渲染骨架
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0)
  })
})
