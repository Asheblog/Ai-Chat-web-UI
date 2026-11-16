import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { OverviewSection } from "../pages/extensions/sections/overview-section"
import { allEnabled } from "./extensions-test-helpers"

/**
 * 总览段单测：三路数据（系统设置 / Skill 待审批 / MCP 连接）全部 mock，
 * 覆盖 Figma 总览结构（页标题、AI 自助安装块、能力紧凑列表、单一空态/真实待办）与失败降级。
 */

const useSystemSettingsMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-system-settings", () => ({
  useSystemSettings: useSystemSettingsMock,
}))

const skillsApiMocks = vi.hoisted(() => ({ listSkillApprovals: vi.fn() }))
vi.mock("@/features/skills/api", () => ({
  listSkillApprovals: skillsApiMocks.listSkillApprovals,
}))

const mcpApiMocks = vi.hoisted(() => ({ listConnections: vi.fn() }))
vi.mock("@/features/mcp/api", () => ({
  listConnections: mcpApiMocks.listConnections,
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

const onNavigate = vi.fn<(section: string, segment?: string) => void>()

/**
 * 能力行是整行按钮：无障碍名以能力名开头（后面跟着说明/数量/状态），
 * 待办行的「去处理」按钮也以能力名开头，用结尾排除掉它。
 */
function capabilityRow(title: string): HTMLElement {
  return screen.getByRole("button", {
    name: (name) => name.startsWith(title) && !name.endsWith("去处理"),
  })
}

/** 待处理行是 li：用例统一靠文案定位，再在行内取按钮。 */
async function pendingRow(text: string): Promise<HTMLElement> {
  const node = await screen.findByText(text)
  const row = node.closest("li")
  if (!row) throw new Error(`未找到待处理行: ${text}`)
  return row as HTMLElement
}

beforeEach(() => {
  vi.resetAllMocks()
  refreshSpy.mockReturnValue(Promise.resolve())
  mockSettings(allEnabled)
  skillsApiMocks.listSkillApprovals.mockResolvedValue({ success: true, data: [] })
  mcpApiMocks.listConnections.mockResolvedValue({ success: true, data: [] })
  updateSpy.mockReturnValue(Promise.resolve())
})

afterEach(() => {
  cleanup()
})

describe("总览段：页标题与 AI 自助安装", () => {
  test("页标题 + 说明，AI 自助安装块里只有一个安装开关和两个入口", async () => {
    const { container } = render(<OverviewSection onNavigate={onNavigate} />)

    expect(screen.getByRole("heading", { name: "工具与扩展", level: 1 })).toBeInTheDocument()
    expect(screen.getByText("管理模型可使用的外部服务、Skill 与内置能力。")).toBeInTheDocument()

    const aiBlock = screen.getByRole("region", { name: "AI 自助安装" })
    expect(within(aiBlock).getByText("在聊天中粘贴 GitHub 链接即可安装扩展")).toBeInTheDocument()
    expect(
      within(aiBlock).getByRole("switch", { name: "允许模型在聊天里按仓库链接安装扩展" }),
    ).toBeInTheDocument()
    expect(within(aiBlock).getByRole("button", { name: "MCP 安装模板" })).toBeInTheDocument()
    expect(within(aiBlock).getByRole("button", { name: "从 GitHub 安装 Skill" })).toBeInTheDocument()

    // 总开关只归各段：总览只有 AI 自助安装这一个开关
    expect(screen.getAllByRole("switch")).toHaveLength(1)
    // 页面根已带 data-section，段组件根节点不得重复
    expect(container.querySelector("[data-section]")).toBeNull()
    await screen.findByText("0 个连接")
  })

  test("非当前段（keep-alive 隐藏）时主标题降为 h2，不与当前段抢 h1", () => {
    render(<OverviewSection onNavigate={onNavigate} active={false} />)

    expect(screen.getByRole("heading", { name: "工具与扩展", level: 2 })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "工具与扩展", level: 1 })).toBeNull()
  })
})

describe("总览段：能力紧凑列表", () => {
  test("四类能力各一行，说明/数量/状态集中对齐，对话增强只给设置项数", async () => {
    mockSettings({ mcpGlobalEnabled: true, chatDynamicSkillRuntimeEnabled: true, pythonToolEnable: true })

    render(<OverviewSection onNavigate={onNavigate} />)
    expect(await screen.findByText("0 个连接")).toBeInTheDocument()

    const mcpRow = capabilityRow("MCP 服务")
    expect(within(mcpRow).getByText("连接外部工具与数据源")).toBeInTheDocument()
    expect(within(mcpRow).getByText("0 个连接")).toBeInTheDocument()
    expect(within(mcpRow).getByText("已启用")).toBeInTheDocument()

    const skillRow = capabilityRow("Skill")
    expect(within(skillRow).getByText("安装、审批与绑定第三方 Skill")).toBeInTheDocument()
    expect(within(skillRow).getByText("无待审批")).toBeInTheDocument()
    expect(within(skillRow).getByText("运行时已开")).toBeInTheDocument()

    const toolsRow = capabilityRow("内置工具")
    expect(within(toolsRow).getByText("在沙箱中执行 Python，管理运行依赖")).toBeInTheDocument()
    expect(within(toolsRow).getByText("Python")).toBeInTheDocument()
    expect(within(toolsRow).getByText("已启用")).toBeInTheDocument()

    const extraRow = capabilityRow("对话增强")
    expect(within(extraRow).getByText("模型大乱斗、标题智能总结")).toBeInTheDocument()
    expect(within(extraRow).getByText("2 项设置")).toBeInTheDocument()
    // 对话增强没有全局开关，不硬塞状态徽标
    expect(within(extraRow).queryByText("已启用")).toBeNull()
  })

  test("设置读取失败：状态徽标为「状态未知」，不冒充已启用/已关闭", async () => {
    useSystemSettingsMock.mockReturnValue({
      settings: null,
      isLoading: false,
      error: "加载系统设置失败",
      refresh: refreshSpy,
      update: updateSpy,
      clearError: vi.fn(),
    })

    render(<OverviewSection onNavigate={onNavigate} />)

    expect(await screen.findByText("0 个连接")).toBeInTheDocument()
    // MCP / Skill / 内置工具 三行能力与 AI 自助安装开关都拿不到设置，一律说「状态未知」
    expect(screen.getAllByText("状态未知")).toHaveLength(4)
    expect(screen.queryByText("已启用")).toBeNull()
    expect(screen.getByText("加载系统设置失败")).toBeInTheDocument()
    expect(refreshSpy).toHaveBeenCalled()
  })

  test("设置加载中给骨架并只补拉一次，不把未加载当默认值", async () => {
    refreshSpy.mockReturnValue(new Promise<void>(() => {}))
    mockSettings(null)

    const { container } = render(<OverviewSection onNavigate={onNavigate} />)

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0)
    // 总览自己补拉一次，AI 自助安装开关也补拉一次：两处都读同一份 store，各自只补一次
    expect(refreshSpy).toHaveBeenCalledTimes(2)
    expect(screen.queryByText("已启用")).toBeNull()
    expect(await screen.findByText("0 个连接")).toBeInTheDocument()
  })
})

describe("总览段：待办", () => {
  test("两路都就绪且为 0：只留一条空态，不再逐条渲染零态行", async () => {
    render(<OverviewSection onNavigate={onNavigate} />)

    expect(await screen.findByText("当前没有待审批调用")).toBeInTheDocument()
    expect(screen.getByText("有待你决定的 Skill 调用时会出现在这里。")).toBeInTheDocument()
    // 凭据绑定只是信息：既不说「都已绑定」，也不说「无需处理」
    expect(screen.queryByText(/未绑定凭据/)).toBeNull()
    expect(screen.queryByText(/无需处理/)).toBeNull()
  })

  test("有真实待办时只渲染待办与操作：2 条待审批可处理，未绑定凭据降为信息行", async () => {
    skillsApiMocks.listSkillApprovals.mockResolvedValue({
      success: true,
      data: [{ id: 1 }, { id: 2 }],
    })
    mcpApiMocks.listConnections.mockResolvedValue({
      success: true,
      data: [{ id: 1, secretVaultId: null }, { id: 2, secretVaultId: 7 }],
    })

    render(<OverviewSection onNavigate={onNavigate} />)

    const approvalsRow = await pendingRow("2 条 Skill 调用待审批")
    fireEvent.click(within(approvalsRow).getByRole("button", { name: /去处理/ }))
    expect(onNavigate).toHaveBeenCalledWith("skills", "approvals")
    expect(screen.queryByText("当前没有待审批调用")).toBeNull()

    // 未绑定凭据不是待办：只给信息与「查看连接」，不当作需要处理的项
    expect(
      await screen.findByText("另有 1 个 MCP 连接尚未绑定凭据；不需要鉴权的连接可以留空。"),
    ).toBeInTheDocument()
    expect(screen.queryByText("1 个 MCP 连接未绑定凭据")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /查看连接/ }))
    expect(onNavigate).toHaveBeenCalledWith("mcp", "connections")

    // 能力行同步显示数量，进入 Skill 直接落到待审批标签
    fireEvent.click(capabilityRow("Skill"))
    expect(onNavigate).toHaveBeenLastCalledWith("skills", "approvals")
    expect(within(capabilityRow("Skill")).getByText("2 条待审批")).toBeInTheDocument()
  })

  test("待审批为 0 但有未绑定连接：空态照常出现，凭据另给信息行", async () => {
    mcpApiMocks.listConnections.mockResolvedValue({
      success: true,
      data: [{ id: 1, secretVaultId: null }],
    })

    render(<OverviewSection onNavigate={onNavigate} />)

    expect(await screen.findByText("当前没有待审批调用")).toBeInTheDocument()
    expect(
      screen.getByText("另有 1 个 MCP 连接尚未绑定凭据；不需要鉴权的连接可以留空。"),
    ).toBeInTheDocument()
    // 没有真实的待办项，就没有「去处理」这种待办操作
    expect(screen.queryByRole("button", { name: /去处理/ })).toBeNull()
    expect(screen.getByRole("button", { name: /查看连接/ })).toBeInTheDocument()
  })

  test("两路都读失败：待办只说状态未知，凭据绑定情况说读不到，空态不出现", async () => {
    skillsApiMocks.listSkillApprovals.mockRejectedValue(new Error("401"))
    mcpApiMocks.listConnections.mockRejectedValue(new Error("500"))

    render(<OverviewSection onNavigate={onNavigate} />)

    expect(await screen.findByText("Skill 调用待审批")).toBeInTheDocument()
    expect(screen.getByText("MCP 连接的凭据绑定情况暂时读不到。")).toBeInTheDocument()
    expect(screen.getByText("状态未知")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /去处理/ })).toBeDisabled()
    expect(screen.queryByText("当前没有待审批调用")).toBeNull()
    // 能力行的数量降级为「—」，不静默当 0
    expect(within(capabilityRow("MCP 服务")).getByText("— 个连接")).toBeInTheDocument()
    expect(within(capabilityRow("Skill")).getByText("— 条待审批")).toBeInTheDocument()
  })

  test("统计加载中给骨架，不提前宣布没有待办", async () => {
    skillsApiMocks.listSkillApprovals.mockImplementation(() => new Promise(() => {}))
    mcpApiMocks.listConnections.mockImplementation(() => new Promise(() => {}))

    const { container } = render(<OverviewSection onNavigate={onNavigate} />)

    expect(screen.queryByText("当前没有待审批调用")).toBeNull()
    await vi.waitFor(() => {
      expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0)
    })
  })
})

describe("总览段：入口跳转", () => {
  test("能力行进入各自段：MCP、内置工具、对话增强", async () => {
    render(<OverviewSection onNavigate={onNavigate} />)
    await screen.findByText("0 个连接")

    fireEvent.click(capabilityRow("MCP 服务"))
    expect(onNavigate).toHaveBeenLastCalledWith("mcp")

    fireEvent.click(capabilityRow("内置工具"))
    expect(onNavigate).toHaveBeenLastCalledWith("tools")

    fireEvent.click(capabilityRow("对话增强"))
    expect(onNavigate).toHaveBeenLastCalledWith("extra")
  })

  test("无待审批时 Skill 行落到版本；AI 块两个按钮跳到安装入口", async () => {
    render(<OverviewSection onNavigate={onNavigate} />)
    await screen.findByText("无待审批")

    fireEvent.click(capabilityRow("Skill"))
    expect(onNavigate).toHaveBeenLastCalledWith("skills", "versions")

    fireEvent.click(screen.getByRole("button", { name: "MCP 安装模板" }))
    expect(onNavigate).toHaveBeenLastCalledWith("mcp", "installations")

    fireEvent.click(screen.getByRole("button", { name: "从 GitHub 安装 Skill" }))
    expect(onNavigate).toHaveBeenLastCalledWith("skills", "install")
  })
})
