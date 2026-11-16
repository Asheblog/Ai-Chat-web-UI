import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { InstallationsTab } from "../system-mcp/installations-tab"

/**
 * MCP 安装模板段：空态与列表头的主操作只能有一个。
 * 表头「共 N 项 + 新建」在 0 项时与空态中央的「新建模板」重复，
 * 空态按已确认的 Figma 只保留中央那一个新建入口。
 */

const toastSpy = vi.hoisted(() => vi.fn())
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
  toast: toastSpy,
}))

const mcpApiMocks = vi.hoisted(() => ({ listInstallations: vi.fn() }))
vi.mock("@/features/mcp/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listInstallations: mcpApiMocks.listInstallations,
}))

function installation(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    namespaceKey: "tavily",
    name: "Tavily 搜索",
    sourceType: "remote",
    transport: "streamable_http",
    endpoint: "https://mcp.tavily.com/mcp",
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}

async function renderTab() {
  const view = render(<InstallationsTab />)
  await act(async () => {})
  return view
}

beforeEach(() => {
  vi.clearAllMocks()
  mcpApiMocks.listInstallations.mockResolvedValue({ success: true, data: [] })
})

afterEach(() => {
  cleanup()
})

describe("MCP 安装模板：空态只留一个新建入口", () => {
  test("没有任何模板时，中央「新建模板」是唯一主操作，表头不再给第二个新建按钮", async () => {
    await renderTab()

    expect(await screen.findByText("暂无安装模板")).toBeInTheDocument()
    const createButtons = screen.getAllByRole("button", { name: /新建/ })
    expect(createButtons).toHaveLength(1)
    expect(createButtons[0]).toHaveAccessibleName("新建模板")
    // 0 项时「共 0 项」只是噪声，列表头整条不渲染
    expect(screen.queryByText("共 0 项")).toBeNull()
  })

  test("有模板时表头给「共 N 项」与唯一的「新建」入口，空态不出现", async () => {
    mcpApiMocks.listInstallations.mockResolvedValue({ success: true, data: [installation()] })

    const { container } = await renderTab()

    expect(await screen.findByText("共 1 项")).toBeInTheDocument()
    expect(screen.queryByText("暂无安装模板")).toBeNull()
    const createButtons = screen.getAllByRole("button", { name: /新建/ })
    expect(createButtons).toHaveLength(1)
    expect(createButtons[0]).toHaveAccessibleName("新建")
    expect(container.querySelector("table")).not.toBeNull()
    expect(screen.getByText("tavily")).toBeInTheDocument()

    await waitFor(() => expect(mcpApiMocks.listInstallations).toHaveBeenCalledTimes(1))
  })
})
