import React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { SystemPythonRuntimePage } from "@/components/settings/pages/SystemPythonRuntime"
import type { PythonRuntimeStatus } from "@/types"

const apiMocks = vi.hoisted(() => ({
  getPythonRuntimeStatus: vi.fn(),
  updatePythonRuntimeIndexes: vi.fn(),
  installPythonRuntimeRequirements: vi.fn(),
  uninstallPythonRuntimePackages: vi.fn(),
  reconcilePythonRuntime: vi.fn(),
}))

vi.mock("@/features/settings/api", () => ({
  getPythonRuntimeStatus: apiMocks.getPythonRuntimeStatus,
  updatePythonRuntimeIndexes: apiMocks.updatePythonRuntimeIndexes,
  installPythonRuntimeRequirements: apiMocks.installPythonRuntimeRequirements,
  uninstallPythonRuntimePackages: apiMocks.uninstallPythonRuntimePackages,
  reconcilePythonRuntime: apiMocks.reconcilePythonRuntime,
}))

const toastSpy = vi.hoisted(() => vi.fn())
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
  toast: toastSpy,
}))

const baseStatus: PythonRuntimeStatus = {
  dataRoot: "/app/data",
  runtimeRoot: "/app/data/python-runtime",
  venvPath: "/app/data/python-runtime/venv",
  pythonPath: "/app/data/python-runtime/venv/bin/python",
  ready: true,
  indexes: {
    indexUrl: "https://pypi.org/simple",
    extraIndexUrls: ["https://mirror.example/simple"],
    trustedHosts: ["mirror.example"],
    autoInstallOnActivate: true,
  },
  manualPackages: ["numpy"],
  installedPackages: [
    { name: "numpy", version: "2.1.0" },
    { name: "pandas", version: "2.2.2" },
  ],
  activeDependencies: [
    {
      skillId: 1,
      skillSlug: "data-agent",
      skillDisplayName: "Data Agent",
      versionId: 2,
      version: "1.0.0",
      requirement: "numpy==2.1.0",
      packageName: "numpy",
    },
  ],
  conflicts: [
    {
      packageName: "numpy",
      requirements: ["numpy==2.1.0", "numpy>=2.0,<2.2"],
      skills: [],
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  apiMocks.getPythonRuntimeStatus.mockResolvedValue({ data: baseStatus })
  apiMocks.updatePythonRuntimeIndexes.mockResolvedValue({ data: {} })
  apiMocks.installPythonRuntimeRequirements.mockResolvedValue({ data: {} })
  apiMocks.uninstallPythonRuntimePackages.mockResolvedValue({ data: {} })
  apiMocks.reconcilePythonRuntime.mockResolvedValue({ data: {} })
})

describe("SystemPythonRuntimePage", () => {
  test("加载状态后显示运行环境信息", async () => {
    render(<SystemPythonRuntimePage />)

    await screen.findByText("Python 运行环境")
    expect(apiMocks.getPythonRuntimeStatus).toHaveBeenCalledTimes(1)
    expect(screen.getByText("/app/data/python-runtime/venv/bin/python")).toBeInTheDocument()
    expect(screen.getByText("已安装 2 个包")).toBeInTheDocument()
    expect(screen.getByText("冲突 1")).toBeInTheDocument()
  })

  test("保存索引配置会发送规范化载荷", async () => {
    render(<SystemPythonRuntimePage />)
    await screen.findByText("Python 运行环境")

    fireEvent.change(screen.getByPlaceholderText("https://pypi.org/simple"), {
      target: { value: "https://pypi.tuna.tsinghua.edu.cn/simple" },
    })
    fireEvent.change(screen.getByPlaceholderText("https://pypi.tuna.tsinghua.edu.cn/simple"), {
      target: { value: "https://mirror1/simple\nhttps://mirror2/simple" },
    })
    fireEvent.change(screen.getByPlaceholderText("pypi.tuna.tsinghua.edu.cn"), {
      target: { value: "mirror1\nmirror2" },
    })

    await userEvent.click(screen.getByRole("button", { name: "已开启" }))
    await userEvent.click(screen.getByRole("button", { name: "保存索引配置" }))

    await waitFor(() => {
      expect(apiMocks.updatePythonRuntimeIndexes).toHaveBeenCalledWith({
        indexUrl: "https://pypi.tuna.tsinghua.edu.cn/simple",
        extraIndexUrls: ["https://mirror1/simple", "https://mirror2/simple"],
        trustedHosts: ["mirror1", "mirror2"],
        autoInstallOnActivate: false,
      })
    })
  })

  test("安装、卸载与 reconcile 会调用对应接口", async () => {
    render(<SystemPythonRuntimePage />)
    await screen.findByText("Python 运行环境")

    const installCard = screen.getByText("安装依赖（手动）").closest("div")
    const installTextarea = installCard?.querySelector("textarea")
    expect(installTextarea).toBeTruthy()
    fireEvent.change(installTextarea!, {
      target: { value: "numpy==2.1.0\npandas>=2.2" },
    })
    await userEvent.click(screen.getByRole("button", { name: "安装依赖" }))

    await waitFor(() => {
      expect(apiMocks.installPythonRuntimeRequirements).toHaveBeenCalledWith({
        requirements: ["numpy==2.1.0", "pandas>=2.2"],
        source: "manual",
      })
    })

    const uninstallCard = screen.getByText("卸载包").closest("div")
    const uninstallTextarea = uninstallCard?.querySelector("textarea")
    expect(uninstallTextarea).toBeTruthy()
    fireEvent.change(uninstallTextarea!, {
      target: { value: "numpy\npandas" },
    })
    await userEvent.click(screen.getByRole("button", { name: "卸载" }))

    await waitFor(() => {
      expect(apiMocks.uninstallPythonRuntimePackages).toHaveBeenCalledWith({
        packages: ["numpy", "pandas"],
      })
    })

    await userEvent.click(screen.getByRole("button", { name: "立即执行" }))

    await waitFor(() => {
      expect(apiMocks.reconcilePythonRuntime).toHaveBeenCalledTimes(1)
    })
  })

  test("运行环境未就绪时显示诊断并禁用依赖操作", async () => {
    apiMocks.getPythonRuntimeStatus.mockResolvedValueOnce({
      data: {
        ...baseStatus,
        ready: false,
        runtimeIssue: {
          code: "PYTHON_RUNTIME_PIP_UNAVAILABLE",
          message: "受管环境 pip 不可用，自动修复失败。",
        },
      },
    })

    render(<SystemPythonRuntimePage />)

    await screen.findByText("运行环境未就绪")
    expect(screen.getByText("受管环境 pip 不可用，自动修复失败。")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "安装依赖" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "卸载" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "立即执行" })).toBeDisabled()
  })
})
