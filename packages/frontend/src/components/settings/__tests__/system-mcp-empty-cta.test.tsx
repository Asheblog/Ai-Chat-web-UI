import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { ConnectionsTab } from "../system-mcp/connections-tab"
import { BindingsTab } from "../system-mcp/bindings-tab"
import { SecretsTab } from "../system-mcp/secrets-tab"

/**
 * MCP 四个列表 tab 的空态只有一个主操作：0 项时列表头（「共 0 项 + 新建」）
 * 与空态中央 CTA 重复，按已确认的 Figma 只留中央那一个。
 * 每个 tab 一条最小断言；有数据时表头仍在由 installations 用例覆盖同一规则。
 */

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
}

const toastSpy = vi.hoisted(() => vi.fn())
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
  toast: toastSpy,
}))

const mcpApiMocks = vi.hoisted(() => ({
  listConnections: vi.fn(),
  listInstallations: vi.fn(),
  listBindings: vi.fn(),
}))
vi.mock("@/features/mcp/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listConnections: mcpApiMocks.listConnections,
  listInstallations: mcpApiMocks.listInstallations,
  listBindings: mcpApiMocks.listBindings,
}))

const secretVaultMocks = vi.hoisted(() => ({ listSecrets: vi.fn() }))
vi.mock("@/features/secret-vault/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listSecrets: secretVaultMocks.listSecrets,
}))

async function renderTab(node: React.ReactElement) {
  const view = render(node)
  await act(async () => {})
  return view
}

beforeEach(() => {
  vi.clearAllMocks()
  mcpApiMocks.listConnections.mockResolvedValue({ success: true, data: [] })
  mcpApiMocks.listInstallations.mockResolvedValue({ success: true, data: [] })
  mcpApiMocks.listBindings.mockResolvedValue({ success: true, data: [] })
  secretVaultMocks.listSecrets.mockResolvedValue({ success: true, data: [] })
})

afterEach(() => {
  cleanup()
})

describe("MCP 列表 tab 空态：只留一个新建入口", () => {
  test("连接：0 项时只剩中央「新建连接」，表头不出「共 0 项」", async () => {
    await renderTab(<ConnectionsTab />)

    expect(await screen.findByText("暂无连接")).toBeInTheDocument()
    const ctas = screen.getAllByRole("button", { name: /新建/ })
    expect(ctas).toHaveLength(1)
    expect(ctas[0]).toHaveAccessibleName("新建连接")
    expect(screen.queryByText("共 0 项")).toBeNull()
  })

  test("绑定：0 项时只剩中央「新建绑定」", async () => {
    await renderTab(<BindingsTab />)

    expect(await screen.findByText("暂无绑定")).toBeInTheDocument()
    const ctas = screen.getAllByRole("button", { name: /新建/ })
    expect(ctas).toHaveLength(1)
    expect(ctas[0]).toHaveAccessibleName("新建绑定")
    expect(screen.queryByText("共 0 项")).toBeNull()
  })

  test("凭据：0 项时只剩中央「新建凭据」", async () => {
    await renderTab(<SecretsTab />)

    expect(await screen.findByText("暂无凭据")).toBeInTheDocument()
    const ctas = screen.getAllByRole("button", { name: /新建/ })
    expect(ctas).toHaveLength(1)
    expect(ctas[0]).toHaveAccessibleName("新建凭据")
    expect(screen.queryByText("共 0 项")).toBeNull()
  })
})
