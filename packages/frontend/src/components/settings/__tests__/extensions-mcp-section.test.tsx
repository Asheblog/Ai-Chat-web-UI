import React from "react"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { McpSection, type McpSegment } from "../pages/extensions/sections/mcp-section"
import { allEnabled } from "./extensions-test-helpers"

const useSystemSettingsMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-system-settings", () => ({
  useSystemSettings: useSystemSettingsMock,
}))

/**
 * 5 个既有 tab 组件背后各是一整组 mcp / secret-vault 请求。
 * 段级用例只关心标签、卡 key 与开关，用 stub 替换，避免连带 mock 三层 API。
 */
vi.mock("@/components/settings/system-mcp/installations-tab", () => ({
  InstallationsTab: () => <p>安装模板面板</p>,
}))
vi.mock("@/components/settings/system-mcp/connections-tab", () => ({
  ConnectionsTab: () => <p>连接面板</p>,
}))
vi.mock("@/components/settings/system-mcp/secrets-tab", () => ({
  SecretsTab: () => <p>凭据面板</p>,
}))
vi.mock("@/components/settings/system-mcp/tools-tab", () => ({
  ToolsTab: () => <p>工具面板</p>,
}))
vi.mock("@/components/settings/system-mcp/bindings-tab", () => ({
  BindingsTab: () => <p>绑定面板</p>,
}))

const refreshSpy = vi.fn<() => Promise<void>>(() => Promise.resolve())
const updateSpy = vi.fn<(patch: Record<string, unknown>) => Promise<void>>(() => Promise.resolve())

function mockSettings(settings: Record<string, unknown> | null) {
  useSystemSettingsMock.mockReturnValue({
    settings,
    isLoading: false,
    error: null,
    refresh: refreshSpy,
    update: updateSpy,
    clearError: vi.fn(),
  })
}

/** MCP 段由页面持有次级标签状态：这里包一层受控外壳模拟 ExtensionsPage。 */
function McpHarness({ initialSegment }: { initialSegment?: McpSegment }) {
  const [segment, setSegment] = React.useState<McpSegment>(initialSegment ?? "installations")
  return <McpSection segment={segment} onSegmentChange={setSegment} />
}

/** 冲掉页头设置请求的 promise，避免异步 setState 脱离 act。 */
async function renderMcp(initialSegment?: McpSegment) {
  const view = render(<McpHarness initialSegment={initialSegment} />)
  await act(async () => {})
  return view
}

const GLOBAL_OFF_HINT = "MCP 全局已关闭，开启后才能连接与调用工具。"

beforeEach(() => {
  vi.resetAllMocks()
  refreshSpy.mockReturnValue(Promise.resolve())
  mockSettings(allEnabled)
  updateSpy.mockReturnValue(Promise.resolve())
})

afterEach(() => {
  cleanup()
})

describe("MCP 段：五标签与全局开关", () => {
  test("5 个次级标签顺序固定且不含「总览」，默认落安装模板并挂上卡 key", async () => {
    const { container } = await renderMcp()

    expect(screen.getAllByRole("tab").map((el) => el.textContent)).toEqual([
      "安装模板",
      "连接",
      "凭据",
      "工具",
      "绑定",
    ])
    expect(screen.queryByRole("tab", { name: "总览" })).toBeNull()

    expect(screen.getByRole("heading", { name: "MCP 服务" })).toBeInTheDocument()
    // 段头说明的唯一来源是 EXTENSION_SECTIONS，不再由段组件各写一份
    expect(screen.getByText("MCP 服务模板、连接、凭据、工具与绑定作用域")).toBeInTheDocument()
    expect(screen.getByText("安装模板面板")).toBeInTheDocument()
    expect(container.querySelector('[data-card-key="extensions:mcp-installations"]')).not.toBeNull()
  })

  test("点「凭据」渲染凭据内容，容器 data-card-key 切到 extensions:mcp-secrets", async () => {
    const { container } = await renderMcp()

    fireEvent.click(screen.getByRole("tab", { name: "凭据" }))

    expect(screen.getByText("凭据面板")).toBeInTheDocument()
    expect(screen.queryByText("安装模板面板")).toBeNull()
    expect(container.querySelector('[data-card-key="extensions:mcp-secrets"]')).not.toBeNull()
    expect(container.querySelector('[data-card-key="extensions:mcp-installations"]')).toBeNull()
  })

  test("全局关闭时安装模板不提示，切到「连接」显示全局关闭提示", async () => {
    mockSettings({ ...allEnabled, mcpGlobalEnabled: false })

    await renderMcp()

    expect(screen.getByText("全局 已关闭")).toBeInTheDocument()
    expect(screen.queryByText(GLOBAL_OFF_HINT)).toBeNull()

    fireEvent.click(screen.getByRole("tab", { name: "连接" }))

    expect(screen.getByText("连接面板")).toBeInTheDocument()
    expect(screen.getByText(GLOBAL_OFF_HINT)).toBeInTheDocument()
  })

  test("设置读取失败时开关显示「状态未知」而非「已开启」，禁用并给重试与错误文案", async () => {
    useSystemSettingsMock.mockReturnValue({
      settings: null,
      isLoading: false,
      error: "加载系统设置失败",
      refresh: refreshSpy,
      update: updateSpy,
      clearError: vi.fn(),
    })

    await renderMcp()

    expect(screen.getByText("全局 状态未知")).toBeInTheDocument()
    expect(screen.queryByText("全局 已开启")).toBeNull()
    expect(screen.getByRole("switch", { name: "全局 MCP 开关" })).toBeDisabled()
    expect(screen.getByText("加载系统设置失败")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument()
    // 状态未知时不得误报「全局已关闭」提示
    fireEvent.click(screen.getByRole("tab", { name: "连接" }))
    expect(screen.queryByText(GLOBAL_OFF_HINT)).toBeNull()
  })

  test("切换全局开关走共享 store，只写一次 { mcpGlobalEnabled: false }", async () => {
    await renderMcp()
    const toggle = screen.getByRole("switch", { name: "全局 MCP 开关" })
    expect(toggle).toHaveAttribute("aria-checked", "true")

    await act(async () => {
      fireEvent.click(toggle)
    })

    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy).toHaveBeenCalledWith({ mcpGlobalEnabled: false })
  })

  test("保存失败时开关仍显示 store 里的原值，不出现半更新状态", async () => {
    updateSpy.mockRejectedValueOnce(new Error("500"))
    await renderMcp()

    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "全局 MCP 开关" }))
    })

    expect(updateSpy).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => {
      expect(screen.getByText("全局 已开启")).toBeInTheDocument()
      expect(screen.getByRole("switch", { name: "全局 MCP 开关" })).toHaveAttribute(
        "aria-checked",
        "true",
      )
      expect(screen.queryByText("保存中...")).toBeNull()
    })
  })
})
