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

/** 推理与网络页完整设置，本地补 temperatureDefault。 */
const reasoningNetworkSettings: SystemSettings = {
  ...baseSettings,
  temperatureDefault: 0.7,
}

/** 整页保存的 19 个 key（11 reasoning + 8 network）。 */
const ALL_KEYS = [
  "reasoningEnabled",
  "reasoningSaveToDb",
  "reasoningTagsMode",
  "reasoningCustomTags",
  "streamDeltaChunkSize",
  "streamDeltaFlushIntervalMs",
  "streamReasoningFlushIntervalMs",
  "streamKeepaliveIntervalMs",
  "openaiReasoningEffort",
  "reasoningMaxOutputTokensDefault",
  "temperatureDefault",
  "sseHeartbeatIntervalMs",
  "providerMaxIdleMs",
  "providerTimeoutMs",
  "providerInitialGraceMs",
  "providerReasoningIdleMs",
  "reasoningKeepaliveIntervalMs",
  "usageEmit",
  "usageProviderOnly",
]

const refreshSpy = vi.fn<[], Promise<void>>(() => Promise.resolve())
const updateSpy = vi.fn<[Partial<SystemSettings>], Promise<void>>(() => Promise.resolve())

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

beforeEach(() => {
  vi.clearAllMocks()
  refreshSpy.mockClear()
  updateSpy.mockClear()
  mockSystemSettings(reasoningNetworkSettings)
})

afterEach(() => {
  cleanup()
})

describe("ReasoningNetworkPage", () => {
  test("渲染三个分区标题且不再显示已移除协议的设置", () => {
    render(<ReasoningNetworkPage />)
    expect(screen.getByText("推理与网络")).toBeInTheDocument()
    expect(screen.getByText("推理链配置")).toBeInTheDocument()
    expect(screen.getByText("流式与性能")).toBeInTheDocument()
    expect(screen.queryByText("Ollama 专属")).not.toBeInTheDocument()
    expect(screen.getByText("网络与超时")).toBeInTheDocument()
    expect(screen.getByText(/这里保持默认即可/)).toBeInTheDocument()
  })

  test("两个折叠分区默认收起，点击展开后可见", async () => {
    render(<ReasoningNetworkPage />)
    const streamCard = getCard("流式与性能")
    const networkCard = getCard("网络与超时")

    expect(within(streamCard).queryByText("流式增量聚合（分片大小）")).not.toBeInTheDocument()
    expect(within(streamCard).queryByText("OpenAI reasoning_effort")).not.toBeInTheDocument()
    expect(within(networkCard).queryByText("SSE 心跳间隔")).not.toBeInTheDocument()

    await userEvent.click(within(streamCard).getByRole("button", { name: "更多参数" }))
    await userEvent.click(within(networkCard).getByRole("button", { name: "更多参数" }))

    expect(within(streamCard).getByText("流式增量聚合（分片大小）")).toBeInTheDocument()
    expect(within(streamCard).getByText("OpenAI reasoning_effort")).toBeInTheDocument()
    expect(within(networkCard).getByText("SSE 心跳间隔")).toBeInTheDocument()
  })

  test("整页保存 payload 精确等于 19 个 key，不携带旧协议设置", async () => {
    render(<ReasoningNetworkPage />)

    // 修改任一字段使保存可用（切换「启用推理链」开关）
    await userEvent.click(screen.getAllByRole("switch")[0])
    await userEvent.click(screen.getByRole("button", { name: "保存设置" }))

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1)
    })
    const payload = updateSpy.mock.calls[0][0] as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual(ALL_KEYS.sort())
    expect(payload).toEqual({
      reasoningEnabled: false,
      reasoningSaveToDb: true,
      reasoningTagsMode: "default",
      reasoningCustomTags: "",
      streamDeltaChunkSize: 1,
      streamDeltaFlushIntervalMs: 800,
      streamReasoningFlushIntervalMs: 1000,
      streamKeepaliveIntervalMs: 5000,
      openaiReasoningEffort: "unset",
      reasoningMaxOutputTokensDefault: 32000,
      temperatureDefault: 0.7,
      sseHeartbeatIntervalMs: 15000,
      providerMaxIdleMs: 60000,
      providerTimeoutMs: 300000,
      providerInitialGraceMs: 120000,
      providerReasoningIdleMs: 300000,
      reasoningKeepaliveIntervalMs: 0,
      usageEmit: true,
      usageProviderOnly: false,
    })
  })

  test("温度非法（>2）→ toast 提示「默认温度无效」且不调用 update", async () => {
    render(<ReasoningNetworkPage />)

    fireEvent.change(screen.getByDisplayValue("0.7"), { target: { value: "3" } })
    await userEvent.click(screen.getByRole("button", { name: "保存设置" }))

    expect(updateSpy).not.toHaveBeenCalled()
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "默认温度无效", variant: "destructive" }),
    )
  })

  test("自定义标签非 JSON → toast「自定义标签无效」且不调用 update", async () => {
    render(<ReasoningNetworkPage />)
    const card = getCard("推理链配置")

    // 标签模式切到「自定义」
    await userEvent.click(within(card).getByRole("combobox"))
    await userEvent.click(await screen.findByRole("option", { name: "自定义" }))

    fireEvent.change(screen.getByPlaceholderText('["<think>","</think>"]'), {
      target: { value: "not-json" },
    })
    await userEvent.click(screen.getByRole("button", { name: "保存设置" }))

    expect(updateSpy).not.toHaveBeenCalled()
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "自定义标签无效", variant: "destructive" }),
    )
  })

  test("网络值非法（sseHeartbeat=500 <1000）→ 保存按钮 disabled（范围无效即 disabled）", async () => {
    render(<ReasoningNetworkPage />)
    const card = getCard("网络与超时")

    await userEvent.click(within(card).getByRole("button", { name: "更多参数" }))
    fireEvent.change(within(card).getByDisplayValue("15000"), { target: { value: "500" } })

    expect(screen.getByRole("button", { name: "保存设置" })).toBeDisabled()
  })

  test("dirty 跟踪：修改任一字段保存启用，改回原值后 disabled", () => {
    render(<ReasoningNetworkPage />)
    const saveButton = screen.getByRole("button", { name: "保存设置" })

    expect(saveButton).toBeDisabled()

    fireEvent.change(screen.getByDisplayValue("0.7"), { target: { value: "1.5" } })
    expect(saveButton).toBeEnabled()

    fireEvent.change(screen.getByDisplayValue("1.5"), { target: { value: "0.7" } })
    expect(saveButton).toBeDisabled()
  })

  test("settings 为 null 且 isLoading 时显示加载骨架，不崩溃", () => {
    mockSystemSettings(null, { isLoading: true })
    const { container } = render(<ReasoningNetworkPage />)

    expect(container.querySelector(".animate-pulse")).not.toBeNull()
    expect(screen.queryByText("推理链配置")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "保存设置" })).not.toBeInTheDocument()
  })

})
