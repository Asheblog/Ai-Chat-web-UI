import React from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"
import { FileText, ShieldCheck, TerminalSquare } from "lucide-react"
import {
  SettingsTabs,
  type SettingsTabDef,
} from "@/components/settings/components/settings-tabs"

const tabs: SettingsTabDef[] = [
  { key: "alpha", label: "Alpha", icon: ShieldCheck, description: "Alpha 描述" },
  { key: "beta", label: "Beta", icon: FileText, description: "Beta 描述" },
  { key: "gamma", label: "Gamma", icon: TerminalSquare, description: "Gamma 描述" },
]

const renderContent = vi.fn((activeKey: string) => <div data-testid="tab-content">{activeKey}</div>)

const getTabButton = (name: string) => screen.getByRole("button", { name })

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("SettingsTabs", () => {
  test("渲染标题（titleOf 生效）与描述、全部 tab 按钮", () => {
    render(
      <SettingsTabs
        tabs={tabs}
        defaultTab="alpha"
        titleOf={(tab) => `${tab.label}日志`}
        renderContent={renderContent}
      />,
    )

    expect(screen.getByRole("heading", { name: "Alpha日志" })).toBeInTheDocument()
    expect(screen.getByText("Alpha 描述")).toBeInTheDocument()
    expect(getTabButton("Alpha")).toBeInTheDocument()
    expect(getTabButton("Beta")).toBeInTheDocument()
    expect(getTabButton("Gamma")).toBeInTheDocument()
  })

  test("默认 tab 内容渲染（renderContent 收到 defaultTab）", () => {
    render(
      <SettingsTabs
        tabs={tabs}
        defaultTab="beta"
        titleOf={(tab) => `${tab.label}日志`}
        renderContent={renderContent}
      />,
    )

    expect(renderContent).toHaveBeenCalledWith("beta")
    expect(screen.getByRole("heading", { name: "Beta日志" })).toBeInTheDocument()
    expect(screen.getByTestId("tab-content").textContent).toBe("beta")
  })

  test("点击其他 tab → renderContent 收到新 key、按钮激活态切换（aria 断言）", () => {
    render(
      <SettingsTabs
        tabs={tabs}
        defaultTab="alpha"
        titleOf={(tab) => `${tab.label}日志`}
        renderContent={renderContent}
      />,
    )

    // 初始：alpha 激活
    expect(getTabButton("Alpha")).toHaveAttribute("aria-pressed", "true")
    expect(getTabButton("Beta")).toHaveAttribute("aria-pressed", "false")
    expect(renderContent).toHaveBeenLastCalledWith("alpha")

    fireEvent.click(getTabButton("Beta"))

    expect(renderContent).toHaveBeenLastCalledWith("beta")
    expect(getTabButton("Beta")).toHaveAttribute("aria-pressed", "true")
    expect(getTabButton("Alpha")).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByRole("heading", { name: "Beta日志" })).toBeInTheDocument()
    expect(screen.getByTestId("tab-content").textContent).toBe("beta")
  })

  test("无 titleOf 时默认取 label", () => {
    render(<SettingsTabs tabs={tabs} defaultTab="gamma" renderContent={renderContent} />)

    expect(screen.getByRole("heading", { name: "Gamma" })).toBeInTheDocument()
    expect(renderContent).toHaveBeenCalledWith("gamma")
  })
})
