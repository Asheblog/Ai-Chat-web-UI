import React from "react"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { DataMaintenancePage } from "@/components/settings/pages/data-maintenance/DataMaintenancePage"
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

const systemApiMocks = vi.hoisted(() => ({
  getTaskTraces: vi.fn(),
  getSystemLogConfig: vi.fn(),
  getSystemLogStats: vi.fn(),
  cleanupTaskTraces: vi.fn(),
  updateSystemLogConfig: vi.fn(),
  cleanupSystemLogs: vi.fn(),
}))
vi.mock("@/features/system/api", () => systemApiMocks)

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/main/settings/system/data-maintenance",
}))

/**
 * 数据与维护页所需 key：baseSettings 已含 chatImageRetentionDays/
 * anonymousRetentionDays/battleRetentionDays/taskTrace* 等；压缩 3 key 缺省由组件默认覆盖（0.5/12/true）。
 * 回答版本上限已整体移除，页面不再读取 assistantReplyHistoryLimit。
 */
const dataMaintenanceSettings: SystemSettings = {
  ...baseSettings,
}

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

/** 渲染并 flush 挂载期异步 API（getTaskTraces/getSystemLogConfig/getSystemLogStats）的微任务 */
const renderPage = async () => {
  return act(async () => render(<DataMaintenancePage />))
}

beforeEach(() => {
  vi.clearAllMocks()
  refreshSpy.mockClear()
  updateSpy.mockClear()
  mockSystemSettings(dataMaintenanceSettings)
  systemApiMocks.getTaskTraces.mockResolvedValue({ data: { total: 5 } })
  systemApiMocks.getSystemLogConfig.mockResolvedValue({
    data: { level: "info", toFile: true, logDir: "/app/logs", retentionDays: 7 },
  })
  systemApiMocks.getSystemLogStats.mockResolvedValue({
    data: { totalFiles: 3, totalSizeBytes: 1536, oldestDate: null, newestDate: null, fileList: [] },
  })
  systemApiMocks.cleanupTaskTraces.mockResolvedValue({ data: { deleted: 12, retentionDays: 7 } })
  systemApiMocks.updateSystemLogConfig.mockResolvedValue({
    data: { level: "info", toFile: true, logDir: "/app/logs", retentionDays: 7 },
  })
  systemApiMocks.cleanupSystemLogs.mockResolvedValue({ data: { deleted: 2, freedBytes: 2048, retentionDays: 7 } })
})

afterEach(() => {
  cleanup()
})

describe("DataMaintenancePage", () => {
  test("渲染五张功能卡：数据保留策略 / 上下文压缩 / 并发生成控制 / 任务追踪 / 系统运行日志", async () => {
    await renderPage()
    expect(screen.getByText("数据与维护")).toBeInTheDocument()
    expect(screen.getByText("数据保留策略")).toBeInTheDocument()
    expect(screen.getByText("上下文压缩")).toBeInTheDocument()
    expect(screen.getByText("并发生成控制")).toBeInTheDocument()
    expect(screen.getByText("任务追踪")).toBeInTheDocument()
    expect(screen.getByText("系统运行日志")).toBeInTheDocument()
  })

  test("保留策略卡不再提供回答版本上限入口，保存 payload 精确 3 key", async () => {
    await renderPage()
    const card = getCard("数据保留策略")

    expect(within(card).queryByText("单条消息 AI 回答上限")).not.toBeInTheDocument()

    // 修改乱斗历史保留天数 15 → 60，保存
    fireEvent.change(within(card).getByDisplayValue("15"), { target: { value: "60" } })
    await userEvent.click(within(card).getByRole("button", { name: "保存保留策略" }))

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1)
    })
    expect(updateSpy.mock.calls[0][0]).toEqual({
      chatImageRetentionDays: 30,
      battleRetentionDays: 60,
      anonymousRetentionDays: 10,
    })

    // 非法值 -2 阻止保存并 toast
    updateSpy.mockClear()
    toastSpy.mockClear()
    fireEvent.change(within(card).getByDisplayValue("60"), { target: { value: "-2" } })
    await userEvent.click(within(card).getByRole("button", { name: "保存保留策略" }))
    expect(updateSpy).not.toHaveBeenCalled()
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "输入无效", variant: "destructive" }),
    )
  })

  test("保留天数填 0 视为永久保留并按 0 提交", async () => {
    await renderPage()
    const card = getCard("数据保留策略")

    fireEvent.change(within(card).getByDisplayValue("30"), { target: { value: "0" } })
    await userEvent.click(within(card).getByRole("button", { name: "保存保留策略" }))

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1)
    })
    expect(updateSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({ chatImageRetentionDays: 0 }),
    )
  })

  test("保存失败时 toast 服务端文案、保留当前输入，且不提示已保存", async () => {
    await renderPage()
    const card = getCard("数据保留策略")
    updateSpy.mockRejectedValueOnce(new Error("system_settings 写入失败"))

    fireEvent.change(within(card).getByDisplayValue("10"), { target: { value: "3" } })
    await userEvent.click(within(card).getByRole("button", { name: "保存保留策略" }))

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "保存失败",
          description: "system_settings 写入失败",
          variant: "destructive",
        }),
      )
    })
    expect(toastSpy).not.toHaveBeenCalledWith(expect.objectContaining({ title: "保留策略已保存" }))
    expect(within(card).getByDisplayValue("3")).toBeInTheDocument()
  })

  test("压缩卡触发阈值/尾部消息数收进高级参数；保存 payload 精确 3 key", async () => {
    await renderPage()
    const card = getCard("上下文压缩")

    // 默认收起：阈值/尾部输入不在可交互层
    expect(within(card).queryByDisplayValue("0.5")).not.toBeInTheDocument()

    await userEvent.click(within(card).getByRole("button", { name: "高级参数" }))
    fireEvent.change(within(card).getByDisplayValue("0.5"), { target: { value: "0.6" } })
    await userEvent.click(within(card).getByRole("button", { name: "保存压缩设置" }))

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1)
    })
    expect(updateSpy.mock.calls[0][0]).toEqual({
      contextCompressionEnabled: true,
      contextCompressionThresholdRatio: 0.6,
      contextCompressionTailMessages: 12,
    })

    // 关闭启用开关 → 高级参数内的输入 disabled
    await userEvent.click(within(card).getAllByRole("switch")[0])
    expect(within(card).getByDisplayValue("0.6")).toBeDisabled()
    expect(within(card).getByDisplayValue("12")).toBeDisabled()
  })

  test("并发卡行内保存 payload 精确 { chatMaxConcurrentStreams }", async () => {
    await renderPage()
    const card = getCard("并发生成控制")

    fireEvent.change(within(card).getByDisplayValue("1"), { target: { value: "3" } })
    await userEvent.click(within(card).getByRole("button", { name: "保存" }))

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1)
    })
    expect(updateSpy.mock.calls[0][0]).toEqual({ chatMaxConcurrentStreams: 3 })
  })

  test("任务追踪：卡头总开关自动保存；保留天数行内保存且文案声明不会自动清理", async () => {
    await renderPage()
    const card = getCard("任务追踪")

    expect(within(card).getByText(/仅作为「立即清理」的删除阈值/)).toBeInTheDocument()

    fireEvent.change(within(card).getByDisplayValue("7"), { target: { value: "30" } })
    await userEvent.click(within(card).getByRole("button", { name: "保存" }))

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1)
    })
    expect(updateSpy.mock.calls[0][0]).toEqual({ taskTraceRetentionDays: 30 })

    // 总开关（卡头 Switch）切换（true → false）自动保存
    updateSpy.mockClear()
    await userEvent.click(within(card).getAllByRole("switch")[0])
    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({ taskTraceEnabled: false })
    })
  })

  test("任务追踪：生效环境给出三档环境语义并沿用已存环境值", async () => {
    await renderPage()
    const card = getCard("任务追踪")

    expect(within(card).getByText("仅开发环境（非 production）")).toBeInTheDocument()
    expect(within(card).getByText(/四道闸门/)).toBeInTheDocument()
  })

  test("任务追踪：单条追踪最大事件数收在高级参数，并接受 100 的下限", async () => {
    await renderPage()
    const card = getCard("任务追踪")

    expect(within(card).queryByDisplayValue("2000")).not.toBeInTheDocument()
    await userEvent.click(within(card).getByRole("button", { name: "高级参数" }))

    const maxEventsRow = within(card).getByText("单条追踪最大事件数").closest('[role="group"]') as HTMLElement
    fireEvent.change(within(maxEventsRow).getByDisplayValue("2000"), { target: { value: "100" } })
    await userEvent.click(within(maxEventsRow).getByRole("button", { name: "保存" }))

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({ taskTraceMaxEvents: 100 })
    })
  })

  test("日志级别 Select 变更触发 updateSystemLogConfig({ level })", async () => {
    await renderPage()
    const card = getCard("系统运行日志")

    await userEvent.click(within(card).getByRole("combobox"))
    await userEvent.click(await screen.findByRole("option", { name: "错误 (Error) - 仅错误" }))

    await waitFor(() => {
      expect(systemApiMocks.updateSystemLogConfig).toHaveBeenCalledWith({ level: "error" })
    })
  })

  test("系统日志说明进程级配置，保留天数只服务立即清理", async () => {
    await renderPage()
    const card = getCard("系统运行日志")

    expect(within(card).getByText(/只保存在当前服务进程，不写系统设置表/)).toBeInTheDocument()
    expect(within(card).getByText(/系统不会按时间自动删除日志文件/)).toBeInTheDocument()
  })

  test("任务追踪「立即清理」调用 cleanupTaskTraces", async () => {
    await renderPage()
    const card = getCard("任务追踪")

    await userEvent.click(within(card).getByRole("button", { name: "立即清理" }))

    await waitFor(() => {
      expect(systemApiMocks.cleanupTaskTraces).toHaveBeenCalledTimes(1)
    })
    expect(systemApiMocks.cleanupTaskTraces).toHaveBeenCalledWith(7)
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "已清理历史追踪" }))
  })

  test("settings 为 null 且 isLoading 时显示加载骨架，不崩溃", async () => {
    mockSystemSettings(null, { isLoading: true })
    const { container } = await renderPage()

    expect(container.querySelector(".animate-pulse")).not.toBeNull()
    expect(screen.queryByText("数据保留策略")).not.toBeInTheDocument()
    expect(screen.queryByText("系统运行日志")).not.toBeInTheDocument()
  })
})
