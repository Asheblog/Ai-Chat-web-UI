import { describe, it, expect, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import {
  ConnectionCredentialBadge,
  ConnectionCredentials,
  parseRequiredEnv,
} from "@/components/settings/system-mcp/connection-credentials"

describe("ConnectionCredentials", () => {
  it("renders one labelled password field per required key", () => {
    const onChange = vi.fn()
    render(
      <ConnectionCredentials
        requiredEnv={["GITHUB_TOKEN", "ORG_ID"]}
        values={{}}
        onChange={onChange}
        configured={false}
      />,
    )
    expect(screen.getByText("GITHUB_TOKEN")).toBeInTheDocument()
    expect(screen.getByText("ORG_ID")).toBeInTheDocument()
    const inputs = screen.getAllByPlaceholderText("填写凭据值")
    expect(inputs).toHaveLength(2)
    const input = inputs[0]!
    expect(input).toHaveAttribute("type", "password")
    fireEvent.change(input, { target: { value: "abc" } })
    expect(onChange).toHaveBeenCalledWith("GITHUB_TOKEN", "abc")
  })

  it("hints that blank keeps the stored value when already configured", () => {
    render(
      <ConnectionCredentials requiredEnv={["TOKEN"]} values={{}} onChange={vi.fn()} configured />,
    )
    expect(screen.getByText(/已配置，留空表示保持原值/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText("保持原值")).toBeInTheDocument()
  })

  it("renders nothing when the installation declares no secrets", () => {
    const { container } = render(
      <ConnectionCredentials requiredEnv={[]} values={{}} onChange={vi.fn()} configured={false} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

describe("parseRequiredEnv", () => {
  it("reads the requiredEnv list", () => {
    expect(parseRequiredEnv(JSON.stringify({ requiredEnv: ["A", "B"] }))).toEqual(["A", "B"])
  })

  it("tolerates empty or broken json", () => {
    expect(parseRequiredEnv("{}")).toEqual([])
    expect(parseRequiredEnv("{oops")).toEqual([])
    expect(parseRequiredEnv(null)).toEqual([])
  })
})

describe("ConnectionCredentialBadge", () => {
  it("distinguishes configured, missing and not-required", () => {
    const { rerender } = render(<ConnectionCredentialBadge configured requiredEnv={["A"]} />)
    expect(screen.getByText("已配置")).toBeInTheDocument()
    rerender(<ConnectionCredentialBadge configured={false} requiredEnv={["A"]} />)
    expect(screen.getByText("缺密钥")).toBeInTheDocument()
    rerender(<ConnectionCredentialBadge configured={false} requiredEnv={[]} />)
    expect(screen.getByText("—")).toBeInTheDocument()
  })
})
