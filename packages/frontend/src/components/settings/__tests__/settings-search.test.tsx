import React from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, test, vi, type MockInstance } from "vitest"
import { SettingsSearch } from "../components/settings-search"
import { SettingsShell } from "../shell"
import type { SettingsNavItem } from "../nav"

afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
})

/** Collect aichat:system-settings-select events dispatched on window. */
function getSelectEvents(dispatchSpy: MockInstance) {
  return dispatchSpy.mock.calls.filter(
    (call): call is [CustomEvent] =>
      call[0] instanceof CustomEvent && call[0].type === "aichat:system-settings-select"
  )
}

describe("SettingsSearch", () => {
  test("输入「模型」按 label 匹配出「模型管理」；输入「密钥」按 keywords 匹配出「供应商与连接」", () => {
    render(<SettingsSearch />)
    const input = screen.getByRole("textbox", { name: "搜索设置" })

    fireEvent.change(input, { target: { value: "模型" } })
    expect(screen.getByText("模型管理")).toBeInTheDocument()

    fireEvent.change(input, { target: { value: "密钥" } })
    expect(screen.getByText("供应商与连接")).toBeInTheDocument()
  })

  test("无匹配输入时显示「无匹配设置」", () => {
    render(<SettingsSearch />)
    const input = screen.getByRole("textbox", { name: "搜索设置" })

    fireEvent.change(input, { target: { value: "不存在的设置项xyz" } })
    expect(screen.getByText("无匹配设置")).toBeInTheDocument()
  })

  test("点击结果项 dispatch aichat:system-settings-select 且 detail.key 正确，输入被清空", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent")
    render(<SettingsSearch />)
    const input = screen.getByRole("textbox", { name: "搜索设置" })

    fireEvent.change(input, { target: { value: "模型" } })
    fireEvent.click(screen.getByText("模型管理"))

    const selectEvents = getSelectEvents(dispatchSpy)
    expect(selectEvents).toHaveLength(1)
    expect(selectEvents[0][0].detail.key).toBe("models")
    expect(input).toHaveValue("")
    expect(screen.queryByText("模型管理")).not.toBeInTheDocument()
  })

  test("ArrowDown 移动高亮（aria-selected），Enter 选择高亮项并 dispatch", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent")
    render(<SettingsSearch />)
    const input = screen.getByRole("textbox", { name: "搜索设置" })

    fireEvent.change(input, { target: { value: "模型" } })

    const options = screen.getAllByRole("option")
    expect(options.length).toBeGreaterThanOrEqual(2)
    expect(options[0]).toHaveAttribute("aria-selected", "true")

    fireEvent.keyDown(input, { key: "ArrowDown" })
    expect(options[1]).toHaveAttribute("aria-selected", "true")

    fireEvent.keyDown(input, { key: "Enter" })
    const selectEvents = getSelectEvents(dispatchSpy)
    expect(selectEvents).toHaveLength(1)
    expect(selectEvents[0][0].detail.key).toBe("mcp")
  })

  test("Escape 收起下拉；清空输入后结果消失", () => {
    render(<SettingsSearch />)
    const input = screen.getByRole("textbox", { name: "搜索设置" })

    fireEvent.change(input, { target: { value: "模型" } })
    expect(screen.getByText("模型管理")).toBeInTheDocument()

    fireEvent.keyDown(input, { key: "Escape" })
    expect(screen.queryByText("模型管理")).not.toBeInTheDocument()

    fireEvent.change(input, { target: { value: "" } })
    expect(screen.queryByText("模型管理")).not.toBeInTheDocument()
    expect(screen.queryByText("无匹配设置")).not.toBeInTheDocument()

    // 清空后重新输入可再次打开下拉
    fireEvent.change(input, { target: { value: "密钥" } })
    expect(screen.getByText("供应商与连接")).toBeInTheDocument()
  })

  test("Escape 收起下拉后再按 Enter 不 dispatch（防止误导航）且不清空输入", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent")
    render(<SettingsSearch />)
    const input = screen.getByRole("textbox", { name: "搜索设置" })

    fireEvent.change(input, { target: { value: "模型" } })
    expect(screen.getByText("模型管理")).toBeInTheDocument()

    fireEvent.keyDown(input, { key: "Escape" })
    expect(screen.queryByText("模型管理")).not.toBeInTheDocument()

    fireEvent.keyDown(input, { key: "Enter" })
    const selectEvents = getSelectEvents(dispatchSpy)
    expect(selectEvents).toHaveLength(0)
    expect(input).toHaveValue("模型")
  })

  test("空输入不显示结果下拉", () => {
    render(<SettingsSearch />)
    expect(screen.getByRole("textbox", { name: "搜索设置" })).toBeInTheDocument()
    expect(screen.queryByRole("option")).not.toBeInTheDocument()
    expect(screen.queryByText("无匹配设置")).not.toBeInTheDocument()
  })

  test("结果项展示所属分组 label（小字）", () => {
    render(<SettingsSearch />)
    const input = screen.getByRole("textbox", { name: "搜索设置" })

    fireEvent.change(input, { target: { value: "模型管理" } })
    expect(screen.getByText("模型与连接")).toBeInTheDocument()
  })

  test("shell：nested 模式 navTop 渲染在导航列表上方", () => {
    const tree: SettingsNavItem[] = [
      {
        key: "system",
        label: "系统设置",
        children: [
          { key: "connections", label: "连接管理" },
          { key: "models", label: "模型管理" },
        ],
      },
    ]
    render(
      <SettingsShell
        mode="nested"
        tree={tree}
        activeMain="system"
        activeSub="connections"
        onChangeMain={vi.fn()}
        onChangeSub={vi.fn()}
        navTop={<div>NAVTOP_SEARCH</div>}
      >
        <div>content</div>
      </SettingsShell>
    )

    const navTopEl = screen.getByText("NAVTOP_SEARCH")
    const navItemEl = screen.getByText("连接管理")
    expect(navTopEl).toBeInTheDocument()
    expect(
      navTopEl.compareDocumentPosition(navItemEl) & Node.DOCUMENT_POSITION_FOLLOWING
    ).not.toBe(0)
  })
})
