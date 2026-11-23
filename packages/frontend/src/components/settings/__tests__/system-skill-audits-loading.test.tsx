import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import { SystemSkillAuditsPage } from "../pages/SystemSkillAudits"

vi.mock("@/features/skills/api", () => ({
  listSkillAudits: vi.fn().mockResolvedValue({ data: { items: [], total: 0 } }),
  listSkillCatalog: vi.fn().mockResolvedValue({ data: [] }),
}))

const imports = vi.hoisted(() => ({ taskTrace: vi.fn(), systemLogs: vi.fn() }))
vi.mock("@/components/task-trace/TaskTraceConsole", () => {
  imports.taskTrace()
  return { TaskTraceConsole: () => <p>任务追踪内容</p> }
})
vi.mock("../pages/SystemLogsPage", () => {
  imports.systemLogs()
  return { SystemLogsPage: () => <p>运行日志内容</p> }
})

afterEach(cleanup)

test("只在首次打开对应页签时加载任务追踪和运行日志", async () => {
  render(<SystemSkillAuditsPage />)
  expect(screen.getByRole("heading", { name: "Skill 审计日志" })).toBeVisible()
  expect(imports.taskTrace).not.toHaveBeenCalled()
  expect(imports.systemLogs).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole("button", { name: "任务追踪" }))
  expect(await screen.findByText("任务追踪内容")).toBeVisible()
  expect(imports.systemLogs).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole("button", { name: "运行日志" }))
  expect(await screen.findByText("运行日志内容")).toBeVisible()
})
