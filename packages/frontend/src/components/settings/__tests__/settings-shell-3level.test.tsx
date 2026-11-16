import React from "react"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"
import { SettingsShell } from "../shell"
import type { SettingsNavItem } from "../nav"
import { Database, LayoutDashboard, PlugZap, Settings, User, Users } from "lucide-react"

/** 3-level tree: main → workspace → leaf */
const threeLevelTree: SettingsNavItem[] = [
  {
    key: "personal",
    label: "个人设置",
    icon: <User className="h-[1.125rem] w-[1.125rem]" />,
    children: [
      { key: "personal.preferences", label: "偏好设置", icon: <Settings className="h-[1.125rem] w-[1.125rem]" /> },
      { key: "personal.about", label: "关于" },
    ],
  },
  {
    key: "system",
    label: "系统设置",
    icon: <Settings className="h-[1.125rem] w-[1.125rem]" />,
    children: [
      {
        key: "configuration-center",
        label: "配置中心",
        icon: <LayoutDashboard className="h-[1.125rem] w-[1.125rem]" />,
        children: [
          { key: "overview", label: "概览", icon: <LayoutDashboard className="h-[1.125rem] w-[1.125rem]" /> },
          { key: "connections", label: "连接管理", icon: <PlugZap className="h-[1.125rem] w-[1.125rem]" /> },
        ],
      },
      {
        key: "knowledge-docs",
        label: "知识库与文档",
        icon: <Database className="h-[1.125rem] w-[1.125rem]" />,
        children: [
          { key: "rag", label: "RAG 文档解析", icon: <Database className="h-[1.125rem] w-[1.125rem]" /> },
          { key: "knowledge-base", label: "知识库管理", icon: <Database className="h-[1.125rem] w-[1.125rem]" /> },
        ],
      },
    ],
  },
]

/** Find the item-icon span (h-[1.125rem] w-[1.125rem]) inside a button, if rendered.
 *  shell 只在 item.icon 存在时才渲染该 span，因此它存在即证明分组行图标已渲染
 * （折叠行的 chevron 是无包裹 span 的裸 svg，不会造成误判）。 */
function findIconSpan(btn: HTMLElement | null | undefined): HTMLSpanElement | null {
  if (!btn) return null
  return (
    Array.from(btn.querySelectorAll("span")).find(
      (span) => span.classList.contains("h-[1.125rem]") && span.classList.contains("w-[1.125rem]")
    ) ?? null
  )
}

afterEach(() => {
  cleanup()
})

describe("SettingsShell 3 级嵌套导航", () => {
  test("分区与目录分层，所有折叠箭头位于行尾的固定列", async () => {
    render(
      <SettingsShell mode="nested" rootLayout="sections" tree={threeLevelTree} activeMain="system" activeSub="overview"
        onChangeMain={vi.fn()} onChangeSub={vi.fn()}>
        <div>content</div>
      </SettingsShell>
    )
    const section = screen.getByRole("button", { name: "系统设置" })
    const directory = await screen.findByRole("button", { name: "配置中心" })
    expect(section).toHaveAttribute("data-nav-section")
    expect(screen.getByRole("heading", { name: "系统设置", level: 3 })).toContainElement(section)
    expect(directory).not.toHaveAttribute("data-nav-section")
    for (const button of [section, directory]) {
      expect(button.lastElementChild).toHaveAttribute("data-nav-chevron")
      expect(button.querySelector("[data-nav-chevron]")).toHaveClass("w-3.5", "shrink-0")
    }
    const leaf = screen.getByRole("button", { name: "概览" })
    expect(leaf.parentElement).toHaveClass("border-l")
    expect(leaf.querySelector("[data-nav-chevron]")).toBeNull()
    expect(findIconSpan(leaf)).toBeNull()
    expect(findIconSpan(directory)).not.toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "个人设置" }))
    // 无图标的个人子项也保留同宽图标列，不退回一级分区标题的位置。
    expect(findIconSpan(screen.getByRole("button", { name: "关于" }))).not.toBeNull()
  })

  test("独立页从目录开始，不套用分区样式，子项统一无图标", async () => {
    render(
      <SettingsShell mode="nested" tree={threeLevelTree[1].children!} activeMain="configuration-center" activeSub="overview"
        onChangeMain={vi.fn()} onChangeSub={vi.fn()}>
        <div>content</div>
      </SettingsShell>
    )
    const directory = screen.getByRole("button", { name: "配置中心" })
    expect(directory).not.toHaveAttribute("data-nav-section")
    expect(findIconSpan(directory)).not.toBeNull()
    expect(findIconSpan(await screen.findByRole("button", { name: "概览" }))).toBeNull()
    expect(findIconSpan(screen.getByRole("button", { name: "连接管理" }))).toBeNull()
  })

  test("渲染顶级主类（个人设置、系统设置）", () => {
    render(
      <SettingsShell
        mode="nested"
        tree={threeLevelTree}
        activeMain="personal"
        activeSub="personal.preferences"
        onChangeMain={vi.fn()}
        onChangeSub={vi.fn()}
      >
        <div>content</div>
      </SettingsShell>
    )

    expect(screen.getByText("个人设置")).toBeInTheDocument()
    expect(screen.getByText("系统设置")).toBeInTheDocument()
  })

  test("顶级主类 activeMain 时展开其子节点", async () => {
    render(
      <SettingsShell
        mode="nested"
        tree={threeLevelTree}
        activeMain="personal"
        activeSub="personal.preferences"
        onChangeMain={vi.fn()}
        onChangeSub={vi.fn()}
      >
        <div>content</div>
      </SettingsShell>
    )

    await waitFor(() => {
      expect(screen.getByText("偏好设置")).toBeInTheDocument()
    })
    expect(screen.getByText("关于")).toBeInTheDocument()
  })

  test("系统设置展开后显示二级工作域名", async () => {
    render(
      <SettingsShell
        mode="nested"
        tree={threeLevelTree}
        activeMain="system"
        activeSub="overview"
        onChangeMain={vi.fn()}
        onChangeSub={vi.fn()}
      >
        <div>content</div>
      </SettingsShell>
    )

    await waitFor(() => {
      expect(screen.getByText("配置中心")).toBeInTheDocument()
    })
    expect(screen.getByText("知识库与文档")).toBeInTheDocument()
  })

  test("三级 leaf 因 auto-expand 祖先工作域后可见", async () => {
    render(
      <SettingsShell
        mode="nested"
        tree={threeLevelTree}
        activeMain="system"
        activeSub="overview"
        onChangeMain={vi.fn()}
        onChangeSub={vi.fn()}
      >
        <div>content</div>
      </SettingsShell>
    )

    await waitFor(() => {
      expect(screen.getByText("概览")).toBeInTheDocument()
    })
    expect(screen.getByText("连接管理")).toBeInTheDocument()
  })

  test("点击二级工作域触发展开/收起，不触发 onChangeSub", async () => {
    const onChangeSub = vi.fn()
    render(
      <SettingsShell
        mode="nested"
        tree={threeLevelTree}
        activeMain="system"
        activeSub="overview"
        onChangeMain={vi.fn()}
        onChangeSub={onChangeSub}
      >
        <div>content</div>
      </SettingsShell>
    )

    await waitFor(() => {
      expect(screen.getByText("概览")).toBeInTheDocument()
    })

    // 配置中心已 auto-expand，点击它应收起
    fireEvent.click(screen.getByText("配置中心"))
    expect(onChangeSub).not.toHaveBeenCalled()

    // 再次点击应展开
    fireEvent.click(screen.getByText("配置中心"))
    expect(onChangeSub).not.toHaveBeenCalled()
  })

  test("点击三级 leaf 触发 onChangeSub", async () => {
    const onChangeSub = vi.fn()
    render(
      <SettingsShell
        mode="nested"
        tree={threeLevelTree}
        activeMain="system"
        activeSub="overview"
        onChangeMain={vi.fn()}
        onChangeSub={onChangeSub}
      >
        <div>content</div>
      </SettingsShell>
    )

    await waitFor(() => {
      expect(screen.getByText("概览")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText("概览"))
    expect(onChangeSub).toHaveBeenCalledWith("overview")

    fireEvent.click(screen.getByText("连接管理"))
    expect(onChangeSub).toHaveBeenCalledWith("connections")
  })

  test("activeSub=rag 时展开其祖先工作域使 leaf 可见", async () => {
    render(
      <SettingsShell
        mode="nested"
        tree={threeLevelTree}
        activeMain="system"
        activeSub="rag"
        onChangeMain={vi.fn()}
        onChangeSub={vi.fn()}
      >
        <div>content</div>
      </SettingsShell>
    )

    await waitFor(() => {
      expect(screen.getByText("知识库与文档")).toBeInTheDocument()
    })
    expect(screen.getByText("RAG 文档解析")).toBeInTheDocument()
  })

  test("顶级主类行（depth-0 折叠行）渲染分组图标", () => {
    render(
      <SettingsShell
        mode="nested"
        tree={threeLevelTree}
        activeMain="personal"
        activeSub="personal.preferences"
        onChangeMain={vi.fn()}
        onChangeSub={vi.fn()}
      >
        <div>content</div>
      </SettingsShell>
    )

    const personalBtn = screen.getByText("个人设置").closest("button")
    const personalIcon = findIconSpan(personalBtn)
    expect(personalIcon).not.toBeNull()
    expect(personalIcon?.querySelector("svg")).not.toBeNull()

    const systemBtn = screen.getByText("系统设置").closest("button")
    const systemIcon = findIconSpan(systemBtn)
    expect(systemIcon).not.toBeNull()
    expect(systemIcon?.querySelector("svg")).not.toBeNull()
  })

  test("二级分组行（depth>=1）渲染分组图标", async () => {
    render(
      <SettingsShell
        mode="nested"
        tree={threeLevelTree}
        activeMain="system"
        activeSub="overview"
        onChangeMain={vi.fn()}
        onChangeSub={vi.fn()}
      >
        <div>content</div>
      </SettingsShell>
    )

    await waitFor(() => {
      expect(screen.getByText("配置中心")).toBeInTheDocument()
    })

    const groupBtn = screen.getByText("配置中心").closest("button")
    const groupIcon = findIconSpan(groupBtn)
    expect(groupIcon).not.toBeNull()
    expect(groupIcon?.querySelector("svg")).not.toBeNull()

    const docsBtn = screen.getByText("知识库与文档").closest("button")
    const docsIcon = findIconSpan(docsBtn)
    expect(docsIcon).not.toBeNull()
    expect(docsIcon?.querySelector("svg")).not.toBeNull()
  })

  test("active leaf 以青绿色高亮并标记当前页", async () => {
    render(
      <SettingsShell
        mode="nested"
        tree={threeLevelTree}
        activeMain="system"
        activeSub="connections"
        onChangeMain={vi.fn()}
        onChangeSub={vi.fn()}
      >
        <div>content</div>
      </SettingsShell>
    )

    await waitFor(() => {
      const connBtn = screen.getByText("连接管理").closest("button")
      expect(connBtn).toHaveAttribute("data-active", "true")
      expect(connBtn).toHaveAttribute("aria-current", "page")
      expect(connBtn?.className).toContain("bg-signal-soft")
    })
  })
})
