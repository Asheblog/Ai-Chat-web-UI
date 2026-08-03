import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { SystemOverviewContent } from "@/components/settings/system-settings-registry-overview"
import type { SystemSettings } from "@/types"

const useSystemSettingsMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-system-settings", () => ({
  useSystemSettings: useSystemSettingsMock,
}))

const useSystemConnectionsMock = vi.hoisted(() => vi.fn())
vi.mock("@/components/settings/system-connections/use-system-connections", () => ({
  useSystemConnections: () => useSystemConnectionsMock(),
}))

const useSystemModelsMock = vi.hoisted(() => vi.fn())
vi.mock("@/components/settings/system-models/use-system-models", () => ({
  useSystemModels: () => useSystemModelsMock(),
}))

const mockSettings = (settings: SystemSettings | null) => {
  useSystemSettingsMock.mockReturnValue({
    settings,
    isLoading: settings === null,
    error: null,
    refresh: vi.fn(),
    update: vi.fn(),
    clearError: vi.fn(),
  })
}

const mockConnections = (connections: unknown[]) => {
  useSystemConnectionsMock.mockReturnValue({ connections })
}

const mockModels = (list: unknown[]) => {
  useSystemModelsMock.mockReturnValue({ list })
}

const satisfiedSettings = {
  allowRegistration: true,
  webSearchAgentEnable: true,
} as SystemSettings

const checklistLabels = ["模型接入", "注册开放", "搜索配置", "默认模型"]
const statusCardTitles = ["模型与连接", "功能与工具", "成员与安全", "系统与数据"]

beforeEach(() => {
  vi.clearAllMocks()
  mockSettings(satisfiedSettings)
  mockConnections([{ id: 1 }])
  mockModels([{ id: "model-1" }])
})

afterEach(() => {
  cleanup()
})

describe("SystemOverviewContent 概览页", () => {
  test("渲染 4 张状态卡标题（新分组结构）", () => {
    render(<SystemOverviewContent />)
    for (const title of statusCardTitles) {
      expect(screen.getByText(title)).toBeInTheDocument()
    }
  })

  test("检查清单 4 项渲染（模型接入/注册开放/搜索配置/默认模型）", () => {
    render(<SystemOverviewContent />)
    expect(screen.getByText("待你完成")).toBeInTheDocument()
    for (const label of checklistLabels) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getAllByRole("button")).toHaveLength(4)
  })

  test("全部条件满足 → 4 项均为「已完成」", () => {
    render(<SystemOverviewContent />)
    expect(screen.getAllByText("已完成")).toHaveLength(4)
    expect(screen.queryByText("待完成")).not.toBeInTheDocument()
  })

  test("条件未满足 → 对应项「待完成」（连接为空时仅模型接入待完成）", () => {
    mockConnections([])
    render(<SystemOverviewContent />)

    const connectionRow = screen.getByText("模型接入").closest("li") as HTMLElement
    expect(within(connectionRow).getByText("待完成")).toBeInTheDocument()

    for (const label of ["注册开放", "搜索配置", "默认模型"]) {
      const row = screen.getByText(label).closest("li") as HTMLElement
      expect(within(row).getByText("已完成")).toBeInTheDocument()
    }
  })

  test("全部条件未满足 → 4 项均为「待完成」", () => {
    mockConnections([])
    mockSettings({ allowRegistration: false, webSearchAgentEnable: false } as SystemSettings)
    mockModels([])
    render(<SystemOverviewContent />)

    expect(screen.getAllByText("待完成")).toHaveLength(4)
    expect(screen.queryByText("已完成")).not.toBeInTheDocument()
  })

  test("点击「去配置 →」（模型接入）派发 aichat:system-settings-select 且 key=connections", () => {
    const handler = vi.fn()
    window.addEventListener("aichat:system-settings-select", handler)
    render(<SystemOverviewContent />)

    fireEvent.click(screen.getByRole("button", { name: "去配置：模型接入" }))

    expect(handler).toHaveBeenCalledTimes(1)
    const event = handler.mock.calls[0][0] as CustomEvent<{ key: string }>
    expect(event.detail.key).toBe("connections")
    window.removeEventListener("aichat:system-settings-select", handler)
  })

  test("底部提示文案渲染", () => {
    render(<SystemOverviewContent />)
    expect(screen.getByText("完成以上即可正常使用，其余参数保持默认。")).toBeInTheDocument()
  })

  test("loading 态（settings 为 null）渲染骨架且不崩溃，状态卡不受阻塞", () => {
    mockSettings(null)
    render(<SystemOverviewContent />)

    expect(screen.getByTestId("overview-checklist-skeleton")).toBeInTheDocument()
    for (const title of statusCardTitles) {
      expect(screen.getByText(title)).toBeInTheDocument()
    }
  })
})
