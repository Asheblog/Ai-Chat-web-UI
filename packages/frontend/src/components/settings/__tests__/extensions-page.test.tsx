import React from "react"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { ExtensionsPage } from "../pages/extensions/ExtensionsPage"
import { EXTENSION_CARD_ROUTES, EXTENSION_SECTION_EVENT, routeForCard } from "../pages/extensions/extensions-sections"
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
 * MCP 段（Task 5）挂载后会直接渲染 5 个既有 tab，它们各自拉取安装模板 / 绑定 / 凭据列表，
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

/** 页面根容器（只有它带 data-section），段内容占位面板带 data-section-panel。 */
function rootOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>("[data-section]")
  if (!el) throw new Error("未找到带 data-section 的页面根容器")
  return el
}

/** 渲染页面并在 act 内冲掉总览段的三路数据 promise，避免异步 setState 警告。 */
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

describe("ExtensionsPage 段路由", () => {
  test("默认渲染总览段，无次级标签", async () => {
    const { container } = await renderPage(<ExtensionsPage />)

    const root = rootOf(container)
    expect(root.dataset.section).toBe("overview")
    expect(root.dataset.segment).toBeUndefined()
    expect(container.querySelector('[data-section-panel="overview"]')).not.toBeNull()
  })

  test("点击左栏「MCP 服务」切段并落到默认次级标签 installations", async () => {
    const { container } = await renderPage(<ExtensionsPage />)

    // MCP 段挂载后会拉设置与安装模板列表，flush 掉这些 promise 再断言
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "MCP 服务" }))
    })

    const root = rootOf(container)
    expect(root.dataset.section).toBe("mcp")
    expect(root.dataset.segment).toBe("installations")
    expect(container.querySelector('[data-section-panel="mcp"]')).not.toBeNull()
    expect(screen.getByRole("tab", { name: "凭据" })).toBeInTheDocument()
  })

  test("aichat:system-settings-select 携带合法 section 时切段", async () => {
    const { container } = await renderPage(<ExtensionsPage />)

    // Skill 段挂载后会拉 catalog / bindings / approvals，flush 掉这些 promise 再断言
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("aichat:system-settings-select", {
          detail: { key: "extensions", section: "skills" },
        }),
      )
    })

    const root = rootOf(container)
    expect(root.dataset.section).toBe("skills")
    expect(root.dataset.segment).toBe("install")
  })

  test("select 事件里非法 section 或非本叶 key 不切段", async () => {
    const { container } = await renderPage(<ExtensionsPage />)

    act(() => {
      window.dispatchEvent(
        new CustomEvent("aichat:system-settings-select", {
          detail: { key: "extensions", section: "not-a-section" },
        }),
      )
      window.dispatchEvent(
        new CustomEvent("aichat:system-settings-select", {
          detail: { key: "models", section: "skills" },
        }),
      )
    })

    expect(rootOf(container).dataset.section).toBe("overview")
  })

  test("冷启动带 initialCardKey 时首帧就落在目标段与次级标签", async () => {
    requestFlash({ leafKey: "extensions", cardKey: "extensions:mcp-secrets", hostId: "layout" })

    const { container } = await renderPage(
      <ExtensionsPage hostId="layout" initialCardKey="extensions:mcp-secrets" />,
    )

    const root = rootOf(container)
    expect(root.dataset.section).toBe("mcp")
    expect(root.dataset.segment).toBe("secrets")
  })

  test("冷启动后在下一宏任务重播定位请求，供 wrapper 重开重试窗口", async () => {
    const seen: Array<{ leafKey?: string; cardKey?: string; hostId?: string }> = []
    const listener = (event: Event) => {
      seen.push((event as CustomEvent<{ leafKey?: string; cardKey?: string; hostId?: string }>).detail)
    }
    window.addEventListener("aichat:settings-flash-card", listener)

    await renderPage(<ExtensionsPage hostId="layout" initialCardKey="extensions:mcp-installations" />)

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    window.removeEventListener("aichat:settings-flash-card", listener)

    expect(seen).toContainEqual({
      leafKey: "extensions",
      cardKey: "extensions:mcp-installations",
      hostId: "layout",
    })
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

  test("aichat:settings-flash-card 热更新定位", async () => {
    const { container } = await renderPage(<ExtensionsPage hostId="layout" />)

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("aichat:settings-flash-card", {
          detail: { leafKey: "extensions", cardKey: "extensions:skill-versions", hostId: "layout" },
        }),
      )
    })

    const root = rootOf(container)
    expect(root.dataset.section).toBe("skills")
    expect(root.dataset.segment).toBe("versions")
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

  test("EXTENSION_SECTION_EVENT 供段内组件请求切段", async () => {
    const { container } = await renderPage(<ExtensionsPage />)

    act(() => {
      window.dispatchEvent(new CustomEvent(EXTENSION_SECTION_EVENT, { detail: { section: "tools" } }))
    })

    expect(rootOf(container).dataset.section).toBe("tools")
    expect(rootOf(container).dataset.segment).toBeUndefined()
  })

  test("页头两个按钮分别切到「新增 MCP 服务」与「从 GitHub 安装 Skill」的位置", async () => {
    const { container } = await renderPage(<ExtensionsPage />)

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "从 GitHub 安装 Skill" }))
    })
    expect(rootOf(container).dataset.section).toBe("skills")
    expect(rootOf(container).dataset.segment).toBe("install")

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "新增 MCP 服务" }))
    })
    expect(rootOf(container).dataset.section).toBe("mcp")
    expect(rootOf(container).dataset.segment).toBe("installations")
  })
})

describe("卡路由与注册表一致", () => {
  test("13 条 extensions 卡逐条映射到正确的段与次级标签", () => {
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
    const cards = systemSettingsCards.filter((card) => card.leafKey === "extensions")

    expect(cards).toHaveLength(13)
    expect(Object.keys(EXTENSION_CARD_ROUTES).sort()).toEqual(Object.keys(expected).sort())
    for (const [cardKey, route] of Object.entries(expected)) {
      expect(routeForCard(cardKey)).toEqual(route)
    }
    expect(routeForCard("extensions:unknown")).toBeNull()
  })
})

describe("注册表挂载路径", () => {
  test("renderSystemLeaf('extensions', 'layout') 渲染出能力扩展页", async () => {
    await renderPage(<>{renderSystemLeaf("extensions", "layout")}</>)

    expect(await screen.findByText("能力扩展")).toBeInTheDocument()
  })

  test("冷启动搜索定位：renderSystemLeaf 渲染期读取 flash 请求并落到目标段（回归：曾落回总览）", async () => {
    requestFlash({ leafKey: "extensions", cardKey: "extensions:mcp-secrets", hostId: "layout" })

    const { container } = await renderPage(<>{renderSystemLeaf("extensions", "layout")}</>)

    const root = await screen.findByRole("heading", { name: "能力扩展" })
    expect(root).toBeInTheDocument()
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
