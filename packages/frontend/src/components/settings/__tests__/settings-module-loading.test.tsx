import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import { createSettingsModule } from "../components/settings-module"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

test("设置模块下载失败后显示恢复操作，重试成功后显示内容", async () => {
  const report = vi.spyOn(console, "error").mockImplementation(() => {})
  const load = vi.fn()
    .mockRejectedValueOnce(new Error("Loading chunk failed"))
    .mockResolvedValueOnce(() => <h2>审计结果</h2>)
  const Audit = createSettingsModule(load, "设置模块")
  render(<Audit />)

  expect(screen.getByRole("status")).toHaveTextContent("正在加载设置模块")
  const failure = await screen.findByRole("alert")
  expect(failure).toHaveTextContent("设置模块加载失败")
  expect(failure).toHaveTextContent("重试后仍失败，请刷新页面。")
  const retry = screen.getByRole("button", { name: "重试" })
  retry.focus()
  fireEvent.click(retry)
  const result = await screen.findByRole("heading", { name: "审计结果" })
  expect(document.activeElement).toContainElement(result)
  expect(load).toHaveBeenCalledTimes(2)
  expect(report).toHaveBeenCalledOnce()
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
})
