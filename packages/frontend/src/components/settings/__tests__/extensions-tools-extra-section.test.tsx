import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { ToolsSection } from "../pages/extensions/sections/tools-section"
import { ExtraSection } from "../pages/extensions/sections/extra-section"
import { allEnabled, emptyRuntimeStatus, featureCardOf, toolsAndExtrasSettings } from "./extensions-test-helpers"

const useSystemSettingsMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-system-settings", () => ({
  useSystemSettings: useSystemSettingsMock,
}))

/** 内置工具段的 Python 运行时卡一挂载就拉 /api/python-runtime：给空状态，避免真实请求。 */
const pythonRuntimeApiMocks = vi.hoisted(() => ({ getPythonRuntimeStatus: vi.fn() }))
vi.mock("@/features/settings/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPythonRuntimeStatus: pythonRuntimeApiMocks.getPythonRuntimeStatus,
}))

/** 乱斗卡的非法值提示要断言：toast 换成 spy，不渲染 Toaster。 */
const toastSpy = vi.hoisted(() => vi.fn())
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
  toast: toastSpy,
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

beforeEach(() => {
  vi.resetAllMocks()
  refreshSpy.mockReturnValue(Promise.resolve())
  mockSettings(allEnabled)
  pythonRuntimeApiMocks.getPythonRuntimeStatus.mockResolvedValue({ data: emptyRuntimeStatus })
  updateSpy.mockReturnValue(Promise.resolve())
})

afterEach(() => {
  cleanup()
})

describe("内置工具段：两卡与唯一控制点", () => {
  test("渲染 Python 工具与 Python 运行时管理两卡，卡 key 为 extensions:python-tools / extensions:python-runtime", async () => {
    mockSettings(toolsAndExtrasSettings)
    const { container } = render(<ToolsSection />)

    expect(screen.getByRole("heading", { name: "内置工具" })).toBeInTheDocument()
    expect(screen.getByText("Python 工具开关与运行时依赖管理")).toBeInTheDocument()

    expect(featureCardOf("Python 工具")).toHaveAttribute(
      "data-card-key",
      "extensions:python-tools",
    )
    expect(featureCardOf("Python 运行时管理")).toHaveAttribute(
      "data-card-key",
      "extensions:python-runtime",
    )
    // 旧页的卡 key 不得残留，否则搜索定位会指向不存在的段
    expect(container.querySelector('[data-card-key^="tools-extensions:"]')).toBeNull()

    await act(async () => {}) // 冲掉运行时状态请求
  })

  test("「更多参数」只剩迭代上限，不再重复动态 Skill Runtime 开关（回归：双控制点）", async () => {
    mockSettings(toolsAndExtrasSettings)
    render(<ToolsSection />)
    const card = featureCardOf("Python 工具")

    expect(within(card).queryByText(/动态 Skill Runtime/)).toBeNull()

    fireEvent.click(within(card).getByRole("button", { name: "更多参数" }))

    expect(within(card).getByText("Agent 工具最大迭代次数（0 表示无限制）")).toBeInTheDocument()
    expect(within(card).queryByText("启用聊天侧第三方动态 Skill Runtime")).toBeNull()
    // 该 key 的唯一控制点已归 Skill 段页头：本卡只保留主开关
    expect(within(card).queryAllByRole("switch")).toHaveLength(1)

    await act(async () => {})
  })

  test("改超时与 stdout 截断后保存，payload 精确等于 5 个 key（不再提交动态 Skill Runtime）", async () => {
    mockSettings(toolsAndExtrasSettings)
    render(<ToolsSection />)
    const card = featureCardOf("Python 工具")

    fireEvent.click(screen.getByRole("switch", { name: "启用Python 工具" }))
    fireEvent.change(within(card).getByDisplayValue("8000"), { target: { value: "9000" } })
    // 两个 4000 分别是 stdout 截断与代码长度限制，前者在前
    const [stdoutInput] = within(card).getAllByDisplayValue("4000")
    fireEvent.change(stdoutInput, { target: { value: "5000" } })

    fireEvent.click(within(card).getByRole("button", { name: "保存 Python 工具设置" }))

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1))
    expect(updateSpy.mock.calls[0][0]).toEqual({
      pythonToolEnable: true,
      pythonToolTimeoutMs: 9000,
      pythonToolMaxOutputChars: 5000,
      pythonToolMaxSourceChars: 4000,
      agentMaxToolIterations: 4,
    })
    expect(Object.keys(updateSpy.mock.calls[0][0]).sort()).toEqual(
      [
        "pythonToolEnable",
        "pythonToolTimeoutMs",
        "pythonToolMaxOutputChars",
        "pythonToolMaxSourceChars",
        "agentMaxToolIterations",
      ].sort(),
    )

    await act(async () => {})
  })

  test("主开关 true→false 后保存，payload 里 pythonToolEnable 为 false 且其余 key 不变", async () => {
    mockSettings({ ...toolsAndExtrasSettings, pythonToolEnable: true })
    render(<ToolsSection />)
    const card = featureCardOf("Python 工具")

    const toggle = screen.getByRole("switch", { name: "启用Python 工具" })
    expect(toggle).toHaveAttribute("aria-checked", "true")

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute("aria-checked", "false")
    fireEvent.click(within(card).getByRole("button", { name: "保存 Python 工具设置" }))

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1))
    expect(updateSpy.mock.calls[0][0]).toEqual({
      pythonToolEnable: false,
      pythonToolTimeoutMs: 8000,
      pythonToolMaxOutputChars: 4000,
      pythonToolMaxSourceChars: 4000,
      agentMaxToolIterations: 4,
    })

    await act(async () => {}) // 冲掉运行时状态请求
  })
})

describe("对话增强段：两卡与保存", () => {
  test("渲染模型大乱斗与标题智能总结两卡，卡 key 为 extensions:battle / extensions:title-summary", () => {
    mockSettings(toolsAndExtrasSettings)
    render(<ExtraSection />)

    expect(screen.getByRole("heading", { name: "对话增强" })).toBeInTheDocument()
    expect(screen.getByText("模型大乱斗与标题智能总结")).toBeInTheDocument()

    expect(featureCardOf("模型大乱斗")).toHaveAttribute("data-card-key", "extensions:battle")
    expect(featureCardOf("标题智能总结")).toHaveAttribute(
      "data-card-key",
      "extensions:title-summary",
    )
  })

  test("乱斗每日次数填 -1 阻止保存并提示；改成合法值后按 4 个 battle* key 提交", async () => {
    mockSettings(toolsAndExtrasSettings)
    render(<ExtraSection />)
    const card = featureCardOf("模型大乱斗")

    fireEvent.change(within(card).getByDisplayValue("8"), { target: { value: "-1" } })
    fireEvent.click(within(card).getByRole("button", { name: "保存乱斗设置" }))

    expect(updateSpy).not.toHaveBeenCalled()
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "输入无效", variant: "destructive" }),
    )

    fireEvent.change(within(card).getByDisplayValue("-1"), { target: { value: "12" } })
    fireEvent.click(within(card).getByRole("button", { name: "保存乱斗设置" }))

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1))
    expect(updateSpy.mock.calls[0][0]).toEqual({
      battleAllowAnonymous: true,
      battleAllowUsers: true,
      battleAnonymousDailyQuota: 12,
      battleUserDailyQuota: 40,
    })
  })

  test("标题总结开关保存 3 个 titleSummary* key", async () => {
    mockSettings(toolsAndExtrasSettings)
    render(<ExtraSection />)
    const card = featureCardOf("标题智能总结")
    const save = within(card).getByRole("button", { name: "保存标题总结设置" })
    expect(save).toBeDisabled()

    fireEvent.click(within(card).getAllByRole("switch")[0])
    expect(save).toBeEnabled()
    fireEvent.click(save)

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1))
    expect(updateSpy.mock.calls[0][0]).toEqual({
      titleSummaryEnabled: true,
      titleSummaryMaxLength: 20,
      titleSummaryModelSource: "current",
    })
  })
})

describe("对话增强段：草稿链路", () => {
  test("标题总结：长度改 30 + 模型来源切到「指定模型（暂不支持）」后保存，payload 精确 3 个 key", async () => {
    mockSettings(toolsAndExtrasSettings)
    render(<ExtraSection />)
    const card = featureCardOf("标题智能总结")

    // 先开启智能标题：关闭态下长度输入与模型选择都是 disabled，改不动
    const titleSummaryEnabled = true
    fireEvent.click(within(card).getAllByRole("switch")[0])
    fireEvent.change(within(card).getByDisplayValue("20"), { target: { value: "30" } })

    await userEvent.click(within(card).getByRole("combobox"))
    await userEvent.click(await screen.findByRole("option", { name: "指定模型（暂不支持）" }))

    fireEvent.click(within(card).getByRole("button", { name: "保存标题总结设置" }))

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1))
    expect(updateSpy.mock.calls[0][0]).toEqual({
      titleSummaryEnabled,
      titleSummaryMaxLength: 30,
      titleSummaryModelSource: "specified",
    })
  })

  test("乱斗：改每日次数后点「还原更改」，输入框回到 store 值且保存按钮重新禁用", async () => {
    mockSettings(toolsAndExtrasSettings)
    render(<ExtraSection />)
    const card = featureCardOf("模型大乱斗")
    const saveButton = within(card).getByRole("button", { name: "保存乱斗设置" })
    expect(saveButton).toBeDisabled()

    fireEvent.change(within(card).getByDisplayValue("8"), { target: { value: "12" } })
    expect(within(card).getByDisplayValue("12")).toBeInTheDocument()
    expect(saveButton).toBeEnabled()

    fireEvent.click(within(card).getByRole("button", { name: "还原更改" }))

    expect(within(card).getByDisplayValue("8")).toBeInTheDocument()
    expect(saveButton).toBeDisabled()
    expect(updateSpy).not.toHaveBeenCalled()
  })
})

describe("两段的设置读取降级", () => {
  test("settings 为 null + error：两段都显示错误文案与「重试」，不渲染任何卡片", () => {
    useSystemSettingsMock.mockReturnValue({
      settings: null,
      isLoading: false,
      error: "加载系统设置失败",
      refresh: refreshSpy,
      update: updateSpy,
      clearError: vi.fn(),
    })

    const { container } = render(
      <>
        <ToolsSection />
        <ExtraSection />
      </>,
    )

    expect(screen.getAllByText("加载系统设置失败")).toHaveLength(2)
    expect(screen.getAllByRole("button", { name: "重试" })).toHaveLength(2)
    expect(container.querySelector("[data-card-key]")).toBeNull()
    expect(screen.queryByText("Python 工具")).toBeNull()
    expect(screen.queryByText("模型大乱斗")).toBeNull()
    // 两段各自补拉一次，不因重渲染反复请求
    expect(refreshSpy).toHaveBeenCalledTimes(2)
  })

  test("settings 为 null 且尚无结果时给骨架，而不是「无法加载」的假错误", () => {
    useSystemSettingsMock.mockReturnValue({
      settings: null,
      isLoading: false,
      error: null,
      refresh: refreshSpy,
      update: updateSpy,
      clearError: vi.fn(),
    })

    const { container } = render(<ToolsSection />)

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText("无法加载系统设置")).toBeNull()
    expect(refreshSpy).toHaveBeenCalledTimes(1)
  })
})
