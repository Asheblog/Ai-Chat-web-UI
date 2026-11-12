import React from "react"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"
import { Boxes, Link2, ShieldCheck } from "lucide-react"
import { SegmentedTabs, type SegmentedTabItem } from "../components/segmented-tabs"

type SegmentKey = "install" | "approvals" | "versions" | "bindings"

const items: SegmentedTabItem<SegmentKey>[] = [
  { key: "install", label: "安装" },
  { key: "approvals", label: "待审批", icon: ShieldCheck, badge: "3" },
  { key: "versions", label: "版本", icon: Boxes, badge: "" },
  { key: "bindings", label: "绑定", icon: Link2 },
]

const ARIA_LABEL = "MCP 子标签"

const renderTabs = (active: SegmentKey, onChange = vi.fn()) =>
  render(<SegmentedTabs items={items} active={active} onChange={onChange} ariaLabel={ARIA_LABEL} />)

afterEach(() => {
  cleanup()
})

describe("SegmentedTabs", () => {
  test("role=tablist 容器 + 每个次级标签渲染为 role=tab", () => {
    renderTabs("install")
    const tablist = screen.getByRole("tablist", { name: ARIA_LABEL })

    const tabs = screen.getAllByRole("tab")
    expect(tabs).toHaveLength(4)
    for (const label of ["安装", "待审批", "版本", "绑定"]) {
      expect(within(tablist).getByText(label)).toBeInTheDocument()
    }
  })

  test("单一横排换行，不产生第二条横向滚动", () => {
    renderTabs("install")
    const tablist = screen.getByRole("tablist", { name: ARIA_LABEL })

    expect(tablist.className).toContain("flex-wrap")
    expect(tablist.className).not.toContain("overflow-x-auto")
    expect(tablist.className).not.toContain("overflow-y-auto")
  })

  test("aria-selected 跟随 active，切换后重新渲染即反转", () => {
    const onChange = vi.fn()
    const { rerender } = renderTabs("install", onChange)

    let tabs = screen.getAllByRole("tab")
    expect(tabs[0]).toHaveAttribute("aria-selected", "true")
    expect(tabs[1]).toHaveAttribute("aria-selected", "false")

    rerender(<SegmentedTabs items={items} active="approvals" onChange={onChange} ariaLabel={ARIA_LABEL} />)

    tabs = screen.getAllByRole("tab")
    expect(tabs[1]).toHaveAttribute("aria-selected", "true")
    expect(tabs[0]).toHaveAttribute("aria-selected", "false")
    expect(tabs[2]).toHaveAttribute("aria-selected", "false")
    expect(onChange).not.toHaveBeenCalled()
  })

  test("点击次级标签回调收到 key（不是 label）", () => {
    const onChange = vi.fn()
    renderTabs("install", onChange)

    fireEvent.click(screen.getByRole("tab", { name: /待审批/ }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith("approvals")
  })

  test("有 badge 时在 label 后渲染 text-micro 圆角徽标", () => {
    renderTabs("install")

    const approvalsTab = screen.getByRole("tab", { name: /待审批/ })
    const badge = within(approvalsTab).getByText("3")
    expect(badge.className).toContain("text-micro")
    expect(badge.className).toContain("rounded-full")
    // 图标 + label + 徽标
    expect(approvalsTab.querySelectorAll("span")).toHaveLength(2)
  })

  test("badge 为空字符串或 undefined 时不渲染徽标", () => {
    renderTabs("install")

    const emptyBadgeTab = screen.getByRole("tab", { name: "版本" })
    expect(emptyBadgeTab.textContent).toBe("版本")
    // 只有 label 一个 span（空 badge 不占位）
    expect(emptyBadgeTab.querySelectorAll("span")).toHaveLength(1)

    const noBadgeTab = screen.getByRole("tab", { name: "绑定" })
    expect(noBadgeTab.textContent).toBe("绑定")
    expect(noBadgeTab.querySelectorAll("span")).toHaveLength(1)
  })

  test("icon 可选：提供时渲染 svg，不提供时仍渲染纯文案标签", () => {
    renderTabs("install")

    const plainTab = screen.getByRole("tab", { name: "安装" })
    expect(plainTab.querySelector("svg")).toBeNull()

    const iconTab = screen.getByRole("tab", { name: "绑定" })
    expect(iconTab.querySelector("svg")).not.toBeNull()
  })

  test("全部标签 type=button、可见焦点环，触控高度 ≥36px", () => {
    renderTabs("install")

    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.getAttribute("type")).toBe("button")
      expect(tab.className).toContain("focus-visible:outline-none")
      expect(tab.className).toContain("focus-visible:ring-2")
      expect(tab.className).toContain("focus-visible:ring-primary")
      expect(tab.className).toContain("min-h-9")
    }
  })
})
