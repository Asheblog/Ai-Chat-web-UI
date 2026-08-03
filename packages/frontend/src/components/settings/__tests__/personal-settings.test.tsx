import React from "react"
import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { PersonalSettings } from "@/components/personal-settings"
import { SystemMcpPage } from "@/components/settings/pages/SystemMcpPage"

// jsdom 未实现 Pointer Capture API（Radix Select / Dropdown 交互依赖）
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

const toastSpy = vi.hoisted(() => vi.fn())
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
  toast: toastSpy,
}))

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light", resolvedTheme: "light", setTheme: vi.fn() }),
}))

const settingsStoreMock = vi.hoisted(() => ({
  contextEnabled: true,
  newConversationContextEnabled: false,
  setContextEnabled: vi.fn(),
  setNewConversationContextEnabled: vi.fn(),
}))
vi.mock("@/store/settings-store", () => ({
  useSettingsStore: () => settingsStoreMock,
}))

const authState = vi.hoisted(() => ({
  user: { username: "tester", avatarUrl: null, personalPrompt: null },
  actorState: "authenticated",
  fetchActor: vi.fn(),
}))
vi.mock("@/store/auth-store", () => ({
  useAuthStore: (selector: any) =>
    typeof selector === "function" ? selector(authState) : authState,
}))

const settingsApiMocks = vi.hoisted(() => ({
  getSystemSettings: vi.fn(),
  updateSystemSettings: vi.fn(),
  updatePersonalSettings: vi.fn(),
}))
vi.mock("@/features/settings/api", () => ({
  getSystemSettings: settingsApiMocks.getSystemSettings,
  updateSystemSettings: settingsApiMocks.updateSystemSettings,
  updatePersonalSettings: settingsApiMocks.updatePersonalSettings,
}))

const shareApiMocks = vi.hoisted(() => ({
  listChatShares: vi.fn(),
  revokeChatShare: vi.fn(),
  updateChatShare: vi.fn(),
}))
vi.mock("@/features/share/api", () => ({
  listChatShares: shareApiMocks.listChatShares,
  revokeChatShare: shareApiMocks.revokeChatShare,
  updateChatShare: shareApiMocks.updateChatShare,
}))

const skillsApiMocks = vi.hoisted(() => ({
  listSkillStore: vi.fn(),
  listSkillCatalog: vi.fn(),
  installSkillFromStore: vi.fn(),
  deleteSkill: vi.fn(),
}))
vi.mock("@/features/skills/api", () => ({
  listSkillStore: skillsApiMocks.listSkillStore,
  listSkillCatalog: skillsApiMocks.listSkillCatalog,
  installSkillFromStore: skillsApiMocks.installSkillFromStore,
  deleteSkill: skillsApiMocks.deleteSkill,
}))

beforeEach(() => {
  vi.clearAllMocks()
  toastSpy.mockClear()
  settingsApiMocks.getSystemSettings.mockResolvedValue({ data: { mcpGlobalEnabled: true } })
  settingsApiMocks.updateSystemSettings.mockResolvedValue({ success: true })
  settingsApiMocks.updatePersonalSettings.mockResolvedValue({ success: true })
  shareApiMocks.listChatShares.mockResolvedValue({ success: true, data: { shares: [] } })
  skillsApiMocks.listSkillStore.mockResolvedValue({ success: true, data: { items: [], sources: [] } })
  skillsApiMocks.listSkillCatalog.mockResolvedValue({ success: true, data: [] })
})

afterEach(() => {
  cleanup()
})

/** 冲刷组件挂载后由 mock Promise 驱动的状态更新 */
const flushAsync = async () => {
  await act(async () => {})
}

describe("PersonalSettings 渲染顺序与锚点", () => {
  test("渲染顺序：shares（最近分享）在 security（修改密码）之前，与导航一致", async () => {
    const { container } = render(<PersonalSettings />)
    await screen.findByText("最近分享")
    await flushAsync()

    const sharesEl = container.querySelector("#settings-share-management")
    const securityEl = container.querySelector("#settings-personal-security")
    expect(sharesEl).not.toBeNull()
    expect(securityEl).not.toBeNull()
    const position = sharesEl!.compareDocumentPosition(securityEl!)
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test("四个锚点 id 仍然存在（hash 滚动依赖）", async () => {
    const { container } = render(<PersonalSettings />)
    await screen.findByText("最近分享")

    for (const id of [
      "settings-personal-preferences",
      "settings-personal-skills",
      "settings-share-management",
      "settings-personal-security",
    ]) {
      expect(container.querySelector(`#${id}`)).not.toBeNull()
    }
  })
})

describe("个人设置页面白话副标题", () => {
  test("各个人页面区副标题可见", async () => {
    render(<PersonalSettings />)
    await screen.findByText("最近分享")

    // 个人资料区（头像 / 用户名 / 主题）
    expect(screen.getByText("管理你的头像、用户名与界面主题")).toBeInTheDocument()
    // 对话与上下文区（上下文记忆开关 + 个人系统提示词）
    expect(
      screen.getByText("设置 AI 是否记住对话上下文，以及你的个人系统提示词"),
    ).toBeInTheDocument()
    // 最近分享区
    expect(screen.getByText("查看、复制或撤销你分享出去的对话")).toBeInTheDocument()
    // 个人 Skills 区（已有副标题，保持不变）
    expect(
      screen.getByText("从内置合规清单安装 GitHub Skill；安装后只能由当前账号在聊天会话里启用。"),
    ).toBeInTheDocument()
  })

  test("MCP 页头副标题可见（已有，保持不变）", async () => {
    render(<SystemMcpPage />)
    await screen.findByText("MCP 管理")

    expect(screen.getByText(/连接外部工具与数据源/)).toBeInTheDocument()
  })
})
