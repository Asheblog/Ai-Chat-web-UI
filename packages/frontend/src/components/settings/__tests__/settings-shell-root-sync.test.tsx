import React from "react"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"
import { SettingsShell } from "../shell"
import type { SettingsNavItem } from "../nav"

const threeLevelTree: SettingsNavItem[] = [
  {
    key: "personal",
    label: "个人设置",
    children: [
      { key: "personal.preferences", label: "偏好设置" },
      { key: "personal.about", label: "关于" },
    ],
  },
  {
    key: "system",
    label: "系统设置",
    children: [
      {
        key: "configuration-center",
        label: "配置中心",
        children: [
          { key: "overview", label: "概览" },
          { key: "connections", label: "连接管理" },
        ],
      },
    ],
  },
]

afterEach(() => {
  cleanup()
})

describe("SettingsShell activeMain 同步", () => {
  test("activeMain=personal activeSub=connections 时 leaf 点击触发 onChangeMain 同步", async () => {
    const onChangeMain = vi.fn()
    const onChangeSub = vi.fn()
    render(
      <SettingsShell
        mode="nested"
        tree={threeLevelTree}
        activeMain="personal"
        activeSub="connections"
        onChangeMain={onChangeMain}
        onChangeSub={onChangeSub}
      >
        <div>content</div>
      </SettingsShell>
    )

    // activeSub=connections → auto-expand 使 system/配置中心/连接管理可见
    await waitFor(() => {
      expect(screen.getByText("连接管理")).toBeInTheDocument()
    })

    // 清除展开按钮 auto-expand 阶段可能触发的调用
    onChangeMain.mockClear()
    onChangeSub.mockClear()

    // 点击连接管理（属于 system 下的三级 leaf）
    fireEvent.click(screen.getByText("连接管理"))

    // leaf 自身应负责同步 activeMain
    expect(onChangeMain).toHaveBeenCalledWith("system")
    expect(onChangeSub).toHaveBeenCalledWith("connections")

    // 确保 onChangeMain 和 onChangeSub 各只被调用一次
    expect(onChangeMain).toHaveBeenCalledTimes(1)
    expect(onChangeSub).toHaveBeenCalledTimes(1)
  })
})
