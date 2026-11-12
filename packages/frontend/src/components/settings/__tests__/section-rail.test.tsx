import React from "react"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"
import { Layers, LayoutDashboard, Wrench } from "lucide-react"
import { SectionRail, type SectionRailItem } from "../components/section-rail"

type SectionKey = "overview" | "mcp" | "tools"

const items: SectionRailItem<SectionKey>[] = [
  { key: "overview", label: "总览", shortLabel: "总览", icon: LayoutDashboard, description: "三类能力状态一览" },
  { key: "mcp", label: "MCP 服务", shortLabel: "MCP", icon: Layers, description: "MCP 全局开关与子标签" },
  { key: "tools", label: "内置工具", icon: Wrench },
]

const ARIA_LABEL = "能力扩展段导航"

const renderRail = (active: SectionKey, onChange = vi.fn()) =>
  render(<SectionRail items={items} active={active} onChange={onChange} ariaLabel={ARIA_LABEL} />)

const desktopNav = () => screen.getByRole("navigation", { name: ARIA_LABEL })
const mobileTablist = () => screen.getByRole("tablist", { name: ARIA_LABEL })

afterEach(() => {
  cleanup()
})

describe("SectionRail", () => {
  test("桌面竖排导航渲染全部段：图标 + label，且带 aria-label", () => {
    renderRail("mcp")
    const nav = desktopNav()

    expect(nav).toHaveClass("hidden", "md:flex", "w-44", "flex-col")

    const buttons = within(nav).getAllByRole("button")
    expect(buttons).toHaveLength(3)
    expect(buttons.map((button) => button.textContent)).toEqual(["总览", "MCP 服务", "内置工具"])
    expect(nav.querySelectorAll("svg")).toHaveLength(3)
  })

  test("激活项带 aria-current=page 与 data-active，非激活项两者都不带", () => {
    renderRail("mcp")
    const nav = desktopNav()

    const activeButton = within(nav).getByRole("button", { name: "MCP 服务" })
    expect(activeButton).toHaveAttribute("aria-current", "page")
    expect(activeButton).toHaveAttribute("data-active", "true")

    for (const name of ["总览", "内置工具"]) {
      const inactiveButton = within(nav).getByRole("button", { name })
      expect(inactiveButton).not.toHaveAttribute("aria-current")
      expect(inactiveButton).not.toHaveAttribute("data-active")
    }
  })

  test("点击非激活项回调收到该项 key（不是 label）", () => {
    const onChange = vi.fn()
    renderRail("mcp", onChange)

    fireEvent.click(within(desktopNav()).getByRole("button", { name: "内置工具" }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith("tools")
  })

  test("纯受控：active 变化后重新渲染，激活态跟随移动，无内部 state", () => {
    const onChange = vi.fn()
    const { rerender } = renderRail("overview", onChange)
    expect(within(desktopNav()).getByRole("button", { name: "总览" })).toHaveAttribute("aria-current", "page")

    rerender(<SectionRail items={items} active="tools" onChange={onChange} ariaLabel={ARIA_LABEL} />)

    expect(within(desktopNav()).getByRole("button", { name: "内置工具" })).toHaveAttribute("aria-current", "page")
    expect(within(desktopNav()).getByRole("button", { name: "总览" })).not.toHaveAttribute("aria-current")
    expect(onChange).not.toHaveBeenCalled()
  })

  test("移动分支 role=tablist 横向滚动，文案用 shortLabel，缺失时回退 label", () => {
    renderRail("mcp")
    const tablist = mobileTablist()

    // overflow-x-auto 会把 overflow-y 也算成 auto：容器必须自己留出左右与上下内边距，
    // 否则按钮外扩 4px 的焦点环会在上缘与首尾被裁掉。
    expect(tablist).toHaveClass("flex", "md:hidden", "overflow-x-auto", "p-1", "-mx-1")

    const tabs = within(tablist).getAllByRole("tab")
    expect(tabs.map((tab) => tab.textContent)).toEqual(["总览", "MCP", "内置工具"])
    expect(tabs[1]).toHaveAttribute("aria-selected", "true")
    expect(tabs[0]).toHaveAttribute("aria-selected", "false")
  })

  test("移动分支点击回调收到 key", () => {
    const onChange = vi.fn()
    renderRail("overview", onChange)

    fireEvent.click(within(mobileTablist()).getByRole("tab", { name: "MCP" }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith("mcp")
  })

  test("全部按钮 type=button、可见焦点环，触控高度 ≥36px", () => {
    renderRail("mcp")
    const buttons = [
      ...within(desktopNav()).getAllByRole("button"),
      ...within(mobileTablist()).getAllByRole("tab"),
    ]

    for (const button of buttons) {
      expect(button.getAttribute("type")).toBe("button")
      expect(button.className).toContain("focus-visible:outline-none")
      expect(button.className).toContain("focus-visible:ring-2")
      expect(button.className).toContain("focus-visible:ring-primary")
      expect(button.className).toContain("focus-visible:ring-offset-background")
      expect(button.className).toContain("min-h-9")
    }
  })

  test("description 作为桌面项的 title 悬停说明，未提供时不渲染该属性", () => {
    renderRail("overview")
    const nav = desktopNav()

    expect(within(nav).getByRole("button", { name: "MCP 服务" })).toHaveAttribute("title", "MCP 全局开关与子标签")
    expect(within(nav).getByRole("button", { name: "内置工具" })).not.toHaveAttribute("title")
  })
})
