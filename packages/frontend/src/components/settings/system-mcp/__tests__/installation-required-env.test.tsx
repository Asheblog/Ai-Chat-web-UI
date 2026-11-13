import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import {
  InstallationRequiredEnv,
  readRequiredEnv,
  writeRequiredEnv,
} from "@/components/settings/system-mcp/installation-required-env"

describe("InstallationRequiredEnv", () => {
  it("shows an empty hint when nothing is declared", () => {
    render(<InstallationRequiredEnv value="{}" onChange={vi.fn()} />)
    expect(screen.getByText(/还没有声明必填变量/)).toBeInTheDocument()
  })

  it("adds an uppercased variable name and writes requiredEnv", () => {
    const onChange = vi.fn()
    render(<InstallationRequiredEnv value="{}" onChange={onChange} />)
    const input = screen.getByLabelText("必需环境变量名称")
    fireEvent.change(input, { target: { value: "github_token" } })
    fireEvent.click(screen.getByRole("button", { name: "添加" }))
    expect(onChange).toHaveBeenCalledWith(JSON.stringify({ requiredEnv: ["GITHUB_TOKEN"] }))
  })

  it("rejects an invalid name without calling onChange", () => {
    const onChange = vi.fn()
    render(<InstallationRequiredEnv value="{}" onChange={onChange} />)
    fireEvent.change(screen.getByLabelText("必需环境变量名称"), { target: { value: "1 bad-name" } })
    fireEvent.click(screen.getByRole("button", { name: "添加" }))
    expect(screen.getByText(/只能使用大写字母/)).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it("removes a declared variable", () => {
    const onChange = vi.fn()
    render(<InstallationRequiredEnv value={JSON.stringify({ requiredEnv: ["A_TOKEN"] })} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText("移除 A_TOKEN"))
    expect(onChange).toHaveBeenCalledWith("{}")
  })

  it("keeps unrelated envJson keys when rewriting", () => {
    const value = JSON.stringify({ FOO: "bar", requiredEnv: ["OLD"] })
    const next = writeRequiredEnv(value, ["NEW_KEY"])
    expect(JSON.parse(next)).toEqual({ FOO: "bar", requiredEnv: ["NEW_KEY"] })
  })
})

describe("readRequiredEnv", () => {
  it("tolerates broken or missing json", () => {
    expect(readRequiredEnv(undefined)).toEqual([])
    expect(readRequiredEnv("{oops")).toEqual([])
    expect(readRequiredEnv(JSON.stringify({ requiredEnv: "nope" }))).toEqual([])
  })
})
