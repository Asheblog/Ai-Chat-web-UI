import { cleanup, fireEvent, render, screen } from "@testing-library/react"
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

const refreshSpy = vi.fn(() => Promise.resolve())

const mockSettings = (
  settings: SystemSettings | null,
  extras: Partial<{ isLoading: boolean; error: string | null }> = {},
) => {
  useSystemSettingsMock.mockReturnValue({
    settings,
    isLoading: settings === null,
    error: null,
    refresh: refreshSpy,
    update: vi.fn(),
    clearError: vi.fn(),
    ...extras,
  })
}

const mockConnections = (
  connections: unknown[],
  extras: Partial<{ loading: boolean; error: string | null }> = {},
) => {
  useSystemConnectionsMock.mockReturnValue({ connections, loading: false, error: null, ...extras })
}

const mockModels = (list: unknown[], isLoading = false) => {
  useSystemModelsMock.mockReturnValue({ list, isLoading })
}

const satisfiedSettings = {
  allowRegistration: true,
  webSearchAgentEnable: true,
  webSearchEnabledEngines: ["tavily", "metaso"],
} as SystemSettings

const privateSettings = {
  allowRegistration: false,
  webSearchAgentEnable: false,
  webSearchEnabledEngines: [],
} as SystemSettings

/** 状态行标题（事实摘要，不是完成度清单）。 */
const STATUS_LABELS = ["模型连接", "可用模型", "联网搜索", "注册与访问"]
/** 6 组入口卡标题（与主导航一致）。 */
const GROUP_TITLES = ["连接与模型", "搜索与知识库", "工具与扩展", "用户与访问", "数据与日志", "外观与站点"]

beforeEach(() => {
  vi.clearAllMocks()
  refreshSpy.mockClear()
  mockSettings(satisfiedSettings)
  mockConnections([{ id: 1 }])
  mockModels([{ id: "model-1" }, { id: "model-2" }])
})

afterEach(() => {
  cleanup()
})

describe("SystemOverviewContent 概览（入口状态摘要）", () => {
  test("渲染 4 条状态行与 6 组入口卡", () => {
    render(<SystemOverviewContent />)

    for (const label of STATUS_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    for (const title of GROUP_TITLES) {
      expect(screen.getByText(title)).toBeInTheDocument()
    }
  })

  test("不再出现「已完成 / 待完成 / 待你完成」的完成率语义", () => {
    render(<SystemOverviewContent />)

    expect(screen.queryByText("已完成")).not.toBeInTheDocument()
    expect(screen.queryByText("待完成")).not.toBeInTheDocument()
    expect(screen.queryByText("待你完成")).not.toBeInTheDocument()
  })

  test("状态行只陈述事实：连接数与模型数，模型列表非空不叫「默认模型」", () => {
    render(<SystemOverviewContent />)

    expect(screen.getByText("已配置 1 个连接")).toBeInTheDocument()
    expect(screen.getByText("已收录 2 个模型")).toBeInTheDocument()
    expect(screen.queryByText("默认模型")).not.toBeInTheDocument()
    expect(screen.queryByText("模型接入")).not.toBeInTheDocument()
  })

  test("关闭注册与搜索是正常部署状态，不算未完成", () => {
    mockSettings(privateSettings)
    mockConnections([])
    mockModels([])
    render(<SystemOverviewContent />)

    expect(screen.getByText("仅管理员创建账号")).toBeInTheDocument()
    expect(screen.getByText("未开启")).toBeInTheDocument()
    expect(screen.getByText("尚未配置连接")).toBeInTheDocument()
    expect(screen.getByText("尚未收录模型")).toBeInTheDocument()
    expect(screen.queryByText("待完成")).not.toBeInTheDocument()
    expect(screen.queryByText("未完成")).not.toBeInTheDocument()
  })

  test("搜索开启时列出启用引擎，作为事实而非完成标记", () => {
    render(<SystemOverviewContent />)

    expect(screen.getByText("已开启 · tavily / metaso")).toBeInTheDocument()
  })

  test("连接读取失败时该行显示错误文案，不伪造状态", () => {
    mockConnections([], { error: "加载失败" })
    render(<SystemOverviewContent />)

    expect(screen.getByText("加载失败")).toBeInTheDocument()
  })

  test("点击「连接与模型」派发 aichat:system-settings-select 且落到组内第一个叶子 connections", () => {
    const handler = vi.fn()
    window.addEventListener("aichat:system-settings-select", handler)
    render(<SystemOverviewContent />)

    fireEvent.click(screen.getByRole("button", { name: "打开连接与模型" }))

    expect(handler).toHaveBeenCalledTimes(1)
    const event = handler.mock.calls[0][0] as CustomEvent<{ key: string }>
    expect(event.detail.key).toBe("connections")
    window.removeEventListener("aichat:system-settings-select", handler)
  })

  test("点击「数据与日志」落到组内第一个叶子 data-maintenance", () => {
    const handler = vi.fn()
    window.addEventListener("aichat:system-settings-select", handler)
    render(<SystemOverviewContent />)

    fireEvent.click(screen.getByRole("button", { name: "打开数据与日志" }))

    const event = handler.mock.calls[0][0] as CustomEvent<{ key: string }>
    expect(event.detail.key).toBe("data-maintenance")
    window.removeEventListener("aichat:system-settings-select", handler)
  })

  test("settings 加载中（null + isLoading）渲染骨架，状态行不崩溃", () => {
    mockSettings(null, { isLoading: true })
    render(<SystemOverviewContent />)

    expect(screen.getByTestId("overview-status-skeleton")).toBeInTheDocument()
    for (const title of GROUP_TITLES) {
      expect(screen.getByText(title)).toBeInTheDocument()
    }
  })

  test("settings 读取失败时给错误文案与重试，而不是空状态", () => {
    mockSettings(null, { isLoading: false, error: "获取系统设置失败" })
    render(<SystemOverviewContent />)

    expect(screen.getByRole("alert")).toBeInTheDocument()
    expect(screen.getByText("获取系统设置失败")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "重新加载" }))
    expect(refreshSpy).toHaveBeenCalledTimes(1)
  })

  test("底部说明不再承诺「完成以上即可正常使用」", () => {
    render(<SystemOverviewContent />)

    expect(screen.queryByText("完成以上即可正常使用，其余参数保持默认。")).not.toBeInTheDocument()
    expect(screen.getByText(/状态只反映当前配置/)).toBeInTheDocument()
  })
})
