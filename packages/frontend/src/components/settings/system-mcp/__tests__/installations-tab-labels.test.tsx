import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { InstallationsTab } from "@/components/settings/system-mcp/installations-tab"

/**
 * 安装模板表单的白话化回归：平铺字段改中文标签、6 个原样字段收进默认收起的 <details>。
 * 字段名、value/onChange 与提交 payload 不属于本用例范围（实现里一字未改）。
 */

const mcpApiMocks = vi.hoisted(() => ({ listInstallations: vi.fn() }))
vi.mock("@/features/mcp/api", () => ({
  listInstallations: mcpApiMocks.listInstallations,
}))

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

/** 平铺区 6 个中文标签：原字段名只在 namespaceKey 后保留括号提示。 */
const FLAT_LABELS = ["标识（namespaceKey）", "名称", "描述", "来源类型", "传输方式", "服务端点"]

/** 收进「高级（原样字段）」的 6 个字段。 */
const ADVANCED_LABELS = ["command", "argsJson", "envJson", "sourceUrl", "sourceKey", "registrySource"]

describe("InstallationsTab 表单标签", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mcpApiMocks.listInstallations.mockResolvedValue({ data: [] })
  })

  it("新建表单使用中文标签，原样字段收进默认收起的 details", async () => {
    const { container } = render(<InstallationsTab />)

    // 等列表请求落地（空列表渲染空状态），再打开表单
    await screen.findByText("暂无安装模板")
    fireEvent.click(screen.getByRole("button", { name: "新建" }))

    for (const label of FLAT_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }

    const details = container.querySelector("details")
    expect(details).not.toBeNull()
    expect(details!.open).toBe(false)
    expect(within(details!).getByText("高级（原样字段）")).toBeInTheDocument()

    for (const label of ADVANCED_LABELS) {
      expect(within(details!).getByText(label)).toBeInTheDocument()
    }
    // 6 个原样字段的输入框都在折叠区内，且端点留在平铺区
    expect(details!.querySelectorAll("input")).toHaveLength(6)
    expect(details!).not.toContainElement(screen.getByText("服务端点"))

    // argsJson 的输入框位于 details 内
    const argsLabel = within(details!).getByText("argsJson")
    const argsInput = argsLabel.parentElement?.querySelector("input")
    expect(argsInput).toBeInstanceOf(HTMLInputElement)
    expect(details).toContainElement(argsInput as HTMLInputElement)
  })
})
