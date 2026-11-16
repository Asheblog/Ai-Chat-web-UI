import React from "react"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { ExtensionsPage } from "../pages/extensions/ExtensionsPage"
import { EXTENSION_CARD_ROUTES, routeForCard } from "../pages/extensions/extensions-sections"
import { extensionLeafForSection } from "../extensions-navigation"
import { consumeFlash, requestFlash } from "../settings-flash-bus"
import { renderSystemLeaf, systemSettingsCards } from "../system-settings-registry"

/**
 * 总览段随页面一起挂载，会拉系统设置 / Skill 待审批 / MCP 连接三路数据。
 * 页面用例只关心段路由，这里全部 mock，避免真实 XHR 与运行环境相关的时序抖动。
 */
const overviewDataMocks = vi.hoisted(() => ({
  useSystemSettings: vi.fn(),
  listSkillApprovals: vi.fn(),
  listSkillCatalog: vi.fn(),
  listSkillBindings: vi.fn(),
  listConnections: vi.fn(),
}))

vi.mock("@/hooks/use-system-settings", () => ({
  useSystemSettings: overviewDataMocks.useSystemSettings,
}))
vi.mock("@/features/skills/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listSkillApprovals: overviewDataMocks.listSkillApprovals,
  listSkillCatalog: overviewDataMocks.listSkillCatalog,
  listSkillBindings: overviewDataMocks.listSkillBindings,
}))

/**
 * MCP 段挂载后会直接渲染 5 个既有 tab，它们各自拉取安装模板 / 绑定 / 凭据列表，
 * 页头开关还直接读写信箱设置接口。这里全部 mock，保持既有段路由断言不变。
 */
const mcpListMocks = vi.hoisted(() => ({
  listInstallations: vi.fn(),
  listBindings: vi.fn(),
}))
vi.mock("@/features/mcp/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listConnections: overviewDataMocks.listConnections,
  listInstallations: mcpListMocks.listInstallations,
  listBindings: mcpListMocks.listBindings,
}))

const secretVaultMocks = vi.hoisted(() => ({ listSecrets: vi.fn() }))
vi.mock("@/features/secret-vault/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listSecrets: secretVaultMocks.listSecrets,
}))

/**
 * 内置工具段里的 Python 运行时卡自带 /api/python-runtime 请求与独立用例
 * （system-python-runtime-page.test.tsx）。页面用例只验证段路由，这里整卡替换，
 * 避免真实 XHR 与异步 setState 抖动。
 */
vi.mock("@/components/settings/pages/tools-extensions/python-runtime-card", () => ({
  PythonRuntimeCard: () => <p>运行时面板</p>,
}))

// jsdom 未实现 scrollIntoView：MCP 段挂上 data-card-key 后，SystemLeafWrapper 会真的滚动到目标卡
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

const SKILL_SOURCE_PLACEHOLDER = "owner/repo@ref[:subdir] 或 github.com/.../SKILL.md"

/** 页面根容器（只有它带 data-section），段内容占位面板带 data-section-panel。 */
function rootOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>("[data-section]")
  if (!el) throw new Error("未找到带 data-section 的页面根容器")
  return el
}

/** 段内容面板：keep-alive 后每个访问过的段各有一个容器，非当前段带原生 hidden。 */
function panelOf(container: HTMLElement, key: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-section-panel="${key}"]`)
  if (!el) throw new Error(`未找到段面板: ${key}`)
  return el
}

/** 渲染页面并在 act 内冲掉段内数据 promise，避免异步 setState 警告。 */
async function renderPage(node: React.ReactElement) {
  const view = render(node)
  await act(async () => {})
  return view
}

beforeEach(() => {
  consumeFlash()
  overviewDataMocks.useSystemSettings.mockReturnValue({
    settings: { mcpGlobalEnabled: true },
    isLoading: false,
    error: null,
    refresh: vi.fn(() => Promise.resolve()),
    update: vi.fn(() => Promise.resolve()),
    clearError: vi.fn(),
  })
  overviewDataMocks.listSkillApprovals.mockResolvedValue({ success: true, data: [] })
  overviewDataMocks.listSkillCatalog.mockResolvedValue({ success: true, data: [] })
  overviewDataMocks.listSkillBindings.mockResolvedValue({ success: true, data: [] })
  overviewDataMocks.listConnections.mockResolvedValue({ success: true, data: [] })
  mcpListMocks.listInstallations.mockResolvedValue({ success: true, data: [] })
  mcpListMocks.listBindings.mockResolvedValue({ success: true, data: [] })
  secretVaultMocks.listSecrets.mockResolvedValue({ success: true, data: [] })
})

afterEach(() => {
  cleanup()
  consumeFlash()
})

describe("ExtensionsPage 段路由：受控段 + keep-alive", () => {
  test("默认渲染总览段，页内不再有段导航（导航统一到设置侧栏）", async () => {
    const { container } = await renderPage(<ExtensionsPage />)

    const root = rootOf(container)
    expect(root.dataset.section).toBe("overview")
    expect(root.dataset.segment).toBeUndefined()
    expect(panelOf(container, "overview")).not.toHaveAttribute("hidden")
    // 页内二次导航已删除：既没有段导航 tablist，段容器也不再自任 tabpanel
    expect(screen.queryByRole("tablist", { name: "工具与扩展分段导航" })).toBeNull()
    expect(container.querySelector('[role="tabpanel"]')).toBeNull()
    // 没访问过的段连容器都不渲染：不提前发请求，也不占 DOM
    expect(container.querySelector('[data-section-panel="mcp"]')).toBeNull()
    expect(container.querySelector('[data-section-panel="skills"]')).toBeNull()
    expect(container.querySelector('[data-section-panel="tools"]')).toBeNull()
    expect(container.querySelector('[data-section-panel="extra"]')).toBeNull()
  })

  test("section prop 决定首屏段：宿主（侧栏）切叶子即可换段", async () => {
    const { container } = await renderPage(<ExtensionsPage section="skills" />)

    const root = rootOf(container)
    expect(root.dataset.section).toBe("skills")
    // 段内次级标签仍由页面持有，默认落安装
    expect(root.dataset.segment).toBe("install")
    expect(panelOf(container, "skills")).not.toHaveAttribute("hidden")
    expect(screen.getByPlaceholderText(SKILL_SOURCE_PLACEHOLDER)).toBeInTheDocument()
  })

  test("section prop 变化经 applyRoute 切段：新段挂载、旧段保留但 hidden", async () => {
    const { container, rerender } = await renderPage(<ExtensionsPage section="overview" />)
    expect(container.querySelector('[data-section-panel="mcp"]')).toBeNull()

    await act(async () => {
      rerender(<ExtensionsPage section="mcp" />)
    })

    const root = rootOf(container)
    expect(root.dataset.section).toBe("mcp")
    expect(root.dataset.segment).toBe("installations")
    expect(panelOf(container, "mcp")).not.toHaveAttribute("hidden")
    // keep-alive：总览段不卸载，只是被藏起来
    expect(panelOf(container, "overview")).toHaveAttribute("hidden")
    expect(screen.getByRole("tab", { name: "凭据" })).toBeInTheDocument()
  })

  test("section prop 来回切换不重建已访问段：Skill 安装草稿与列表请求都保留", async () => {
    const { container, rerender } = await renderPage(<ExtensionsPage section="skills" />)

    const requestCount = () =>
      overviewDataMocks.listSkillCatalog.mock.calls.length +
      overviewDataMocks.listSkillBindings.mock.calls.length +
      overviewDataMocks.listSkillApprovals.mock.calls.length
    const afterFirstMount = requestCount()

    fireEvent.change(screen.getByPlaceholderText(SKILL_SOURCE_PLACEHOLDER), {
      target: { value: "anthropics/skills@main:skills/pptx" },
    })

    await act(async () => {
      rerender(<ExtensionsPage section="tools" />)
    })
    expect(panelOf(container, "skills")).toHaveAttribute("hidden")

    await act(async () => {
      rerender(<ExtensionsPage section="skills" />)
    })

    expect(panelOf(container, "skills")).not.toHaveAttribute("hidden")
    expect(screen.getByPlaceholderText(SKILL_SOURCE_PLACEHOLDER)).toHaveValue(
      "anthropics/skills@main:skills/pptx",
    )
    // 段常驻后切回来不重建组件，catalog / bindings / approvals 不会重发
    expect(requestCount()).toBe(afterFirstMount)
  })

  test("受控段下总览入口仍即时切段，并把目标段回调给宿主", async () => {
    const onSectionChange = vi.fn<(section: string) => void>()

    const { container } = await renderPage(
      <ExtensionsPage section="overview" onSectionChange={onSectionChange} />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /内置工具/ }))
    })

    expect(onSectionChange).toHaveBeenCalledWith("tools")
    // 宿主还没回写 prop 时也立刻切过去，避免点了没反应
    expect(rootOf(container).dataset.section).toBe("tools")
  })
})

describe("ExtensionsPage 冷启动与深链", () => {
  test("initialCardKey 在首帧优先于 section prop：深链不会先闪到总览", async () => {
    const { container } = await renderPage(
      <ExtensionsPage section="overview" initialCardKey="extensions:mcp-secrets" />,
    )

    const root = rootOf(container)
    expect(root.dataset.section).toBe("mcp")
    expect(root.dataset.segment).toBe("secrets")
  })

  test("冷启动后在下一宏任务用当前 leafKey 重播定位请求", async () => {
    const seen: Array<{ leafKey?: string; cardKey?: string; hostId?: string }> = []
    const listener = (event: Event) => {
      seen.push((event as CustomEvent<{ leafKey?: string; cardKey?: string; hostId?: string }>).detail)
    }
    window.addEventListener("aichat:settings-flash-card", listener)

    await renderPage(
      <ExtensionsPage
        hostId="layout"
        leafKey="extensions-mcp"
        initialCardKey="extensions:mcp-installations"
      />,
    )

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    window.removeEventListener("aichat:settings-flash-card", listener)

    expect(seen).toContainEqual({
      leafKey: "extensions-mcp",
      cardKey: "extensions:mcp-installations",
      hostId: "layout",
    })
  })

  test("默认 leafKey 为 extensions：旧叶子冷启动重播沿用旧 key，不硬编码子页", async () => {
    const seen: Array<{ leafKey?: string }> = []
    const listener = (event: Event) => {
      seen.push((event as CustomEvent<{ leafKey?: string }>).detail)
    }
    window.addEventListener("aichat:settings-flash-card", listener)

    await renderPage(<ExtensionsPage hostId="layout" initialCardKey="extensions:skill-versions" />)
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    window.removeEventListener("aichat:settings-flash-card", listener)

    expect(seen).toContainEqual({ leafKey: "extensions", cardKey: "extensions:skill-versions", hostId: "layout" })
  })

  test("其它宿主（dialog）的 flash 请求不参与本页定位且不被清空", async () => {
    requestFlash({ leafKey: "extensions", cardKey: "extensions:mcp-secrets", hostId: "dialog" })

    const { container } = await renderPage(<ExtensionsPage hostId="layout" initialCardKey={undefined} />)

    expect(rootOf(container).dataset.section).toBe("overview")
    expect(consumeFlash()).toEqual({
      leafKey: "extensions",
      cardKey: "extensions:mcp-secrets",
      hostId: "dialog",
    })
  })

  test("已挂载时接受任一扩展子页 leafKey 的定位事件（不写死 extensions）", async () => {
    const { container } = await renderPage(<ExtensionsPage hostId="layout" leafKey="extensions" />)

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("aichat:settings-flash-card", {
          detail: { leafKey: "extensions-skills", cardKey: "extensions:skill-versions", hostId: "layout" },
        }),
      )
    })

    const root = rootOf(container)
    expect(root.dataset.section).toBe("skills")
    expect(root.dataset.segment).toBe("versions")
  })

  test("非扩展叶子的定位事件被忽略：本页不接管别的设置页请求", async () => {
    const { container } = await renderPage(<ExtensionsPage hostId="layout" />)

    act(() => {
      window.dispatchEvent(
        new CustomEvent("aichat:settings-flash-card", {
          detail: { leafKey: "models", cardKey: "extensions:skill-versions", hostId: "layout" },
        }),
      )
    })

    expect(rootOf(container).dataset.section).toBe("overview")
  })

  test("其它宿主的 settings-flash-card 事件不切本宿主页面的段", async () => {
    const { container } = await renderPage(<ExtensionsPage hostId="layout" />)

    act(() => {
      window.dispatchEvent(
        new CustomEvent("aichat:settings-flash-card", {
          detail: { leafKey: "extensions", cardKey: "extensions:skill-versions", hostId: "dialog" },
        }),
      )
    })

    expect(rootOf(container).dataset.section).toBe("overview")
  })
})

describe("卡路由与注册表一致", () => {
  test("13 条 extensions 卡逐条映射到正确的段、次级标签与新叶子", () => {
    const expected: Record<string, { section: string; segment?: string }> = {
      "extensions:mcp-installations": { section: "mcp", segment: "installations" },
      "extensions:mcp-connections": { section: "mcp", segment: "connections" },
      "extensions:mcp-secrets": { section: "mcp", segment: "secrets" },
      "extensions:mcp-tools": { section: "mcp", segment: "tools" },
      "extensions:mcp-bindings": { section: "mcp", segment: "bindings" },
      "extensions:skill-install": { section: "skills", segment: "install" },
      "extensions:skill-approvals": { section: "skills", segment: "approvals" },
      "extensions:skill-versions": { section: "skills", segment: "versions" },
      "extensions:skill-bindings": { section: "skills", segment: "bindings" },
      "extensions:python-tools": { section: "tools" },
      "extensions:python-runtime": { section: "tools" },
      "extensions:battle": { section: "extra" },
      "extensions:title-summary": { section: "extra" },
    }

    expect(Object.keys(EXTENSION_CARD_ROUTES).sort()).toEqual(Object.keys(expected).sort())
    for (const [cardKey, route] of Object.entries(expected)) {
      expect(routeForCard(cardKey)).toEqual(route)
      // 搜索定位用新叶子渲染页面，卡的归属叶子必须与段的叶子一致，否则会先渲染错页
      const card = systemSettingsCards.find((item) => item.key === cardKey)
      expect(card?.leafKey).toBe(extensionLeafForSection(route.section as never))
    }
    expect(routeForCard("extensions:unknown")).toBeNull()
  })
})

describe("注册表挂载路径", () => {
  test("renderSystemLeaf('extensions', 'layout') 渲染出工具与扩展总览页", async () => {
    await renderPage(<>{renderSystemLeaf("extensions", "layout")}</>)

    expect(await screen.findByRole("heading", { name: "工具与扩展", level: 1 })).toBeInTheDocument()
  })

  test("renderSystemLeaf('extensions-mcp', 'layout') 直接落到 MCP 段", async () => {
    const { container } = await renderPage(<>{renderSystemLeaf("extensions-mcp", "layout")}</>)

    expect(await screen.findByRole("heading", { name: "MCP 服务", level: 1 })).toBeInTheDocument()
    expect(rootOf(container).dataset.section).toBe("mcp")
  })

  test("冷启动搜索定位：renderSystemLeaf 渲染期读取 flash 请求并落到目标段与标签", async () => {
    requestFlash({ leafKey: "extensions-mcp", cardKey: "extensions:mcp-secrets", hostId: "layout" })

    const { container } = await renderPage(<>{renderSystemLeaf("extensions-mcp", "layout")}</>)

    expect(await screen.findByRole("heading", { name: "MCP 服务", level: 1 })).toBeInTheDocument()
    const panel = container.querySelector<HTMLElement>("[data-section]")
    expect(panel?.dataset.section).toBe("mcp")
    expect(panel?.dataset.segment).toBe("secrets")
  })

  test("未知与已废弃 leaf key 仍返回 null", () => {
    expect(renderSystemLeaf("tools-extensions")).toBeNull()
    expect(renderSystemLeaf("mcp")).toBeNull()
    expect(renderSystemLeaf("skills-governance")).toBeNull()
    expect(renderSystemLeaf("unknown-key")).toBeNull()
  })
})
