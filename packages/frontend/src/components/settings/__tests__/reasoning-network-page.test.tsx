import React from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { ReasoningNetworkPage } from "@/components/settings/pages/reasoning-network/ReasoningNetworkPage"
import type { SystemSettings } from "@/types"
import { baseSettings } from "./system-settings-pages.fixtures"

// jsdom 未实现 Pointer Capture API，Radix Select 打开菜单依赖它
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

const toastSpy = vi.hoisted(() => vi.fn())
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
  toast: toastSpy,
}))

/** 生成与网络页完整设置。 */
const reasoningNetworkSettings: SystemSettings = {
  ...baseSettings,
  temperatureDefault: 0.7,
}

/**
 * 整页保存的 16 个 key：
 * 移除 providerMaxIdleMs（无消费者的死字段）与 usageEmit/usageProviderOnly（部署内部协议策略）。
 */
const ALL_KEYS = [
  "reasoningEnabled",
  "reasoningSaveToDb",
  "reasoningTagsMode",
  "reasoningCustomTags",
  "openaiReasoningEffort",
  "reasoningMaxOutputTokensDefault",
  "temperatureDefault",
  "streamDeltaChunkSize",
  "streamDeltaFlushIntervalMs",
  "streamReasoningFlushIntervalMs",
  "streamKeepaliveIntervalMs",
  "sseHeartbeatIntervalMs",
  "providerTimeoutMs",
  "providerInitialGraceMs",
  "providerReasoningIdleMs",
  "reasoningKeepaliveIntervalMs",
]

const refreshSpy = vi.fn<() => Promise<void>>(() => Promise.resolve())
const updateSpy = vi.fn<(arg: Partial<SystemSettings>) => Promise<void>>(() => Promise.resolve())

const mockSystemSettings = (
  settings: SystemSettings | null,
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

/** 通过卡片标题定位 FeatureCard 的 <section> 根节点 */
const getCard = (title: string) => {
  const heading = screen.getByText(title)
  const section = heading.closest("section")
  if (!section) throw new Error(`未找到卡片容器: ${title}`)
  return section as HTMLElement
}

/** 展开卡片的高级折叠区 */
const expand = async (title: string) => {
  const card = getCard(title)
  await userEvent.click(within(card).getByRole("button", { name: "更多参数" }))
  return card
}

beforeEach(() => {
  vi.clearAllMocks()
  refreshSpy.mockClear()
  updateSpy.mockClear()
  mockSystemSettings(reasoningNetworkSettings)
})

afterEach(() => {
  cleanup()
})

describe("ReasoningNetworkPage（数据与日志 → 生成与网络（高级））", () => {
  test("渲染页头与三张卡；生成上限改名、不再出现「默认生成 Tokens」", () => {
    render(<ReasoningNetworkPage />)

    expect(screen.getByText("生成与网络")).toBeInTheDocument()
    expect(screen.getByText("推理与生成")).toBeInTheDocument()
    expect(screen.getByText("流式与传输")).toBeInTheDocument()
    expect(screen.getByText("网络与超时")).toBeInTheDocument()
    expect(screen.queryByText("推理链配置")).not.toBeInTheDocument()
    expect(screen.queryByText(/默认生成 Tokens/)).not.toBeInTheDocument()
  })

  test("高级参数默认收起：温度/生成上限/标签兼容/分片都藏在折叠区里", () => {
    render(<ReasoningNetworkPage />)
    const reasoningCard = getCard("推理与生成")
    const streamCard = getCard("流式与传输")
    const networkCard = getCard("网络与超时")

    expect(within(reasoningCard).queryByText("默认温度")).not.toBeInTheDocument()
    expect(within(reasoningCard).queryByText("默认生成上限")).not.toBeInTheDocument()
    expect(within(streamCard).queryByText("流式增量聚合（分片大小）")).not.toBeInTheDocument()
    expect(within(networkCard).queryByText("SSE 心跳间隔")).not.toBeInTheDocument()

    // 主层只留「识别」与「保存」两件事
    expect(within(reasoningCard).getByText("启用推理识别")).toBeInTheDocument()
    expect(within(reasoningCard).getByText("保存推理文本")).toBeInTheDocument()
  })

  test("展开后可见高级参数，且自定义标签输入只在「自定义」模式出现", async () => {
    render(<ReasoningNetworkPage />)
    const card = await expand("推理与生成")

    expect(within(card).getByText("默认温度")).toBeInTheDocument()
    expect(within(card).getByText("默认生成上限")).toBeInTheDocument()
    expect(within(card).getByText("标签兼容")).toBeInTheDocument()
    expect(within(card).getByText("推理强度兜底")).toBeInTheDocument()
    expect(within(card).queryByPlaceholderText('[" thinking","</think>"]')).not.toBeInTheDocument()

    await userEvent.click(within(card).getByRole("combobox", { name: "标签兼容" }))
    await userEvent.click(await screen.findByRole("option", { name: "自定义标签" }))

    expect(within(card).getByRole("textbox", { name: "自定义标签 JSON 数组" })).toBeInTheDocument()
  })

  test("不再暴露 providerMaxIdleMs 与 usage 协议开关（部署内部策略）", async () => {
    render(<ReasoningNetworkPage />)
    const networkCard = await expand("网络与超时")

    expect(within(networkCard).queryByText("上游最大空闲")).not.toBeInTheDocument()
    expect(within(networkCard).queryByText("推送用量（usage）")).not.toBeInTheDocument()
    expect(within(networkCard).queryByText("仅透传厂商 usage")).not.toBeInTheDocument()
    expect(within(networkCard).getByText("SSE 心跳间隔")).toBeInTheDocument()
    expect(within(networkCard).getByText("上游总体超时")).toBeInTheDocument()
  })

  test("整页保存 payload 精确等于 16 个 key，不含死字段与内部协议开关", async () => {
    render(<ReasoningNetworkPage />)

    await userEvent.click(screen.getAllByRole("switch")[0])
    await userEvent.click(screen.getByRole("button", { name: "保存设置" }))

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1)
    })
    const payload = updateSpy.mock.calls[0][0] as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual([...ALL_KEYS].sort())
    expect(payload).toEqual({
      reasoningEnabled: false,
      reasoningSaveToDb: true,
      reasoningTagsMode: "default",
      reasoningCustomTags: "",
      openaiReasoningEffort: "unset",
      reasoningMaxOutputTokensDefault: 32000,
      temperatureDefault: 0.7,
      streamDeltaChunkSize: 1,
      streamDeltaFlushIntervalMs: 800,
      streamReasoningFlushIntervalMs: 1000,
      streamKeepaliveIntervalMs: 5000,
      sseHeartbeatIntervalMs: 15000,
      providerTimeoutMs: 300000,
      providerInitialGraceMs: 120000,
      providerReasoningIdleMs: 300000,
      reasoningKeepaliveIntervalMs: 0,
    })
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "已保存生成与网络设置" }))
  })

  test("生成上限留空 = 自动（提交 0，由模型与协议解析），不写死 32K", async () => {
    mockSystemSettings({ ...reasoningNetworkSettings, reasoningMaxOutputTokensDefault: 0 })
    render(<ReasoningNetworkPage />)
    const card = await expand("推理与生成")

    expect(within(card).getByText("默认生成上限")).toBeInTheDocument()
    expect(within(card).getByPlaceholderText("自动")).toHaveValue("")

    // 让页面进入 dirty（切换「保存推理文本」），保存时上限仍按自动提交 0
    await userEvent.click(within(card).getAllByRole("switch")[1])
    await userEvent.click(screen.getByRole("button", { name: "保存设置" }))

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1)
    })
    expect((updateSpy.mock.calls[0][0] as Record<string, unknown>).reasoningMaxOutputTokensDefault).toBe(0)
  })

  test("显式填写生成上限时按数值提交", async () => {
    mockSystemSettings({ ...reasoningNetworkSettings, reasoningMaxOutputTokensDefault: 0 })
    render(<ReasoningNetworkPage />)
    const card = await expand("推理与生成")

    fireEvent.change(within(card).getByPlaceholderText("自动"), { target: { value: "8192" } })
    await userEvent.click(screen.getByRole("button", { name: "保存设置" }))

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1)
    })
    expect((updateSpy.mock.calls[0][0] as Record<string, unknown>).reasoningMaxOutputTokensDefault).toBe(8192)
  })

  test("温度非法（>2）→ toast「默认温度无效」且不调用 update", async () => {
    render(<ReasoningNetworkPage />)
    const card = await expand("推理与生成")

    fireEvent.change(within(card).getByDisplayValue("0.7"), { target: { value: "3" } })
    await userEvent.click(screen.getByRole("button", { name: "保存设置" }))

    expect(updateSpy).not.toHaveBeenCalled()
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "默认温度无效", variant: "destructive" }),
    )
  })

  test("自定义标签非 JSON → toast「自定义标签无效」且不调用 update", async () => {
    render(<ReasoningNetworkPage />)
    const card = await expand("推理与生成")

    await userEvent.click(within(card).getByRole("combobox", { name: "标签兼容" }))
    await userEvent.click(await screen.findByRole("option", { name: "自定义标签" }))
    fireEvent.change(within(card).getByRole("textbox", { name: "自定义标签 JSON 数组" }), {
      target: { value: "not-json" },
    })
    await userEvent.click(screen.getByRole("button", { name: "保存设置" }))

    expect(updateSpy).not.toHaveBeenCalled()
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "自定义标签无效", variant: "destructive" }),
    )
  })

  test("网络值非法（sseHeartbeat=500 <1000）→ 保存按钮 disabled", async () => {
    render(<ReasoningNetworkPage />)
    const card = await expand("网络与超时")

    fireEvent.change(within(card).getByDisplayValue("15000"), { target: { value: "500" } })

    expect(screen.getByRole("button", { name: "保存设置" })).toBeDisabled()
  })

  test("保存失败 → toast 失败文案、保留输入、不再提示已保存", async () => {
    updateSpy.mockRejectedValueOnce(new Error("权限不足"))
    render(<ReasoningNetworkPage />)
    const card = await expand("推理与生成")

    fireEvent.change(within(card).getByDisplayValue("0.7"), { target: { value: "1.2" } })
    await userEvent.click(screen.getByRole("button", { name: "保存设置" }))

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "保存失败", description: "权限不足", variant: "destructive" }),
      )
    })
    expect(toastSpy).not.toHaveBeenCalledWith(expect.objectContaining({ title: "已保存生成与网络设置" }))
    // 输入不被回滚
    expect(within(card).getByDisplayValue("1.2")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "保存设置" })).toBeEnabled()
  })

  test("推理强度兜底按 不设置 → low → medium → high → xhigh → max 排列", async () => {
    render(<ReasoningNetworkPage />)
    const card = await expand("推理与生成")
    await userEvent.click(within(card).getByRole("combobox", { name: "推理强度兜底" }))
    const options = await screen.findAllByRole("option")
    expect(options.map(option => option.textContent?.trim())).toEqual([
      "不设置", "low", "medium", "high", "xhigh", "max",
    ])
  })

  test("dirty 跟踪：修改任一字段保存启用，改回原值后 disabled", async () => {
    render(<ReasoningNetworkPage />)
    const saveButton = screen.getByRole("button", { name: "保存设置" })
    const card = await expand("推理与生成")

    expect(saveButton).toBeDisabled()

    fireEvent.change(within(card).getByDisplayValue("0.7"), { target: { value: "1.5" } })
    expect(saveButton).toBeEnabled()

    fireEvent.change(within(card).getByDisplayValue("1.5"), { target: { value: "0.7" } })
    expect(saveButton).toBeDisabled()
  })

  test("settings 为 null 且 isLoading 时显示加载骨架，不崩溃", () => {
    mockSystemSettings(null, { isLoading: true })
    const { container } = render(<ReasoningNetworkPage />)

    expect(container.querySelector(".animate-pulse")).not.toBeNull()
    expect(screen.queryByText("推理与生成")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "保存设置" })).not.toBeInTheDocument()
  })

  test("settings 读取失败 → 错误文案与重试按钮", () => {
    mockSystemSettings(null, { isLoading: false, error: "获取系统设置失败" })
    render(<ReasoningNetworkPage />)

    expect(screen.getByText("获取系统设置失败")).toBeInTheDocument()

    refreshSpy.mockClear()
    fireEvent.click(screen.getByRole("button", { name: "重试" }))
    expect(refreshSpy).toHaveBeenCalledTimes(1)
  })
})
