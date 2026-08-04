import React from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"
import { Globe } from "lucide-react"
import { FeatureCard } from "../components/feature-card"

afterEach(() => {
  cleanup()
})

describe("FeatureCard", () => {
  test("渲染图标瓦片、标题、描述与 children 内容区", () => {
    const { container } = render(
      <FeatureCard icon={Globe} title="联网搜索" description="在回答前自动检索网页，支持多引擎并行">
        <div>内容行</div>
      </FeatureCard>,
    )
    // 图标瓦片：容器内存在 svg（Lucide 图标）
    expect(container.querySelector("svg")).not.toBeNull()
    expect(screen.getByText("联网搜索")).toBeInTheDocument()
    expect(screen.getByText("在回答前自动检索网页，支持多引擎并行")).toBeInTheDocument()
    expect(screen.getByText("内容行")).toBeInTheDocument()
  })

  test("提供 enabled/onEnabledChange 时渲染 Switch，点击触发回调", () => {
    const onEnabledChange = vi.fn()
    render(
      <FeatureCard
        icon={Globe}
        title="联网搜索"
        enabled={false}
        onEnabledChange={onEnabledChange}
      />,
    )
    const toggle = screen.getByRole("switch", { name: "启用联网搜索" })
    expect(toggle).toBeInTheDocument()
    fireEvent.click(toggle)
    expect(onEnabledChange).toHaveBeenCalledTimes(1)
    expect(onEnabledChange).toHaveBeenCalledWith(true)
  })

  test("未提供开关 props 时不渲染 Switch", () => {
    render(<FeatureCard icon={Globe} title="联网搜索" />)
    expect(screen.queryByRole("switch")).not.toBeInTheDocument()
  })

  test("「更多参数」默认收起，点击展开/收起且 aria-expanded 正确翻转", () => {
    render(
      <FeatureCard icon={Globe} title="联网搜索" more={<div>高级参数</div>}>
        <div>内容行</div>
      </FeatureCard>,
    )
    // 默认收起：more 内容不在文档中
    expect(screen.queryByText("高级参数")).not.toBeInTheDocument()

    const button = screen.getByRole("button", { name: /更多参数/ })
    expect(button.getAttribute("aria-expanded")).toBe("false")
    // 收起时无 aria-controls（折叠区尚未挂载）
    expect(button.getAttribute("aria-controls")).toBeNull()

    // 点击展开
    fireEvent.click(button)
    expect(screen.getByText("高级参数")).toBeInTheDocument()
    expect(button.getAttribute("aria-expanded")).toBe("true")
    // 展开时 aria-controls 指向折叠区 id
    const regionId = button.getAttribute("aria-controls")
    expect(regionId).not.toBeNull()
    expect(document.getElementById(regionId!)).toContainHTML("高级参数")

    // 再点收起
    fireEvent.click(button)
    expect(screen.queryByText("高级参数")).not.toBeInTheDocument()
    expect(button.getAttribute("aria-expanded")).toBe("false")
  })

  test("moreLabel 可自定义文案", () => {
    render(
      <FeatureCard icon={Globe} title="联网搜索" moreLabel="展开高级选项" more={<div>x</div>} />,
    )
    expect(screen.getByRole("button", { name: /展开高级选项/ })).toBeInTheDocument()
  })

  test("未提供 more 时不渲染「更多参数」按钮", () => {
    render(<FeatureCard icon={Globe} title="联网搜索" />)
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  test("footer 仅在提供时渲染", () => {
    const { rerender } = render(<FeatureCard icon={Globe} title="联网搜索" />)
    expect(screen.queryByText("保存")).not.toBeInTheDocument()

    rerender(<FeatureCard icon={Globe} title="联网搜索" footer={<button type="button">保存</button>} />)
    expect(screen.getByText("保存")).toBeInTheDocument()
  })

  test("不提供 more/footer/开关时无多余 DOM（无按钮、无分隔线）", () => {
    const { container } = render(<FeatureCard icon={Globe} title="联网搜索" />)
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    expect(screen.queryByRole("switch")).not.toBeInTheDocument()
    expect(container.querySelector(".border-t")).toBeNull()
  })

  test("cardKey 渲染 data-card-key 定位属性；未提供时不渲染该属性", () => {
    const { container } = render(
      <FeatureCard icon={Globe} title="联网搜索" cardKey="search-knowledge:web-search" />,
    )
    const section = container.querySelector("section")
    expect(section?.getAttribute("data-card-key")).toBe("search-knowledge:web-search")

    const { container: plainContainer } = render(<FeatureCard icon={Globe} title="联网搜索" />)
    expect(plainContainer.querySelector("section")?.hasAttribute("data-card-key")).toBe(false)
  })
})
