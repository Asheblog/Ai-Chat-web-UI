import { screen } from "@testing-library/react"
import { baseSettings } from "./system-settings-pages.fixtures"

/**
 * 段级用例的共用脚手架：jsdom 缺失的 Pointer Capture、三段共用的默认设置、
 * 内置工具段与对话增强段共用的运行时状态空壳，以及 FeatureCard 的定位函数。
 * vi.mock 与用例本体仍留在各自的测试文件里。
 */

// jsdom 未实现 Pointer Capture API，Radix Select 打开菜单依赖它
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

export const allEnabled = {
  mcpGlobalEnabled: true,
  chatDynamicSkillRuntimeEnabled: true,
  pythonToolEnable: true,
}

/** 内置工具 / 对话增强两段共用：补齐 python、乱斗、标题卡的 key（baseSettings 已含 python 与 battle 四项）。 */
export const toolsAndExtrasSettings = { ...baseSettings, chatDynamicSkillRuntimeEnabled: false }

/** 空运行时状态：本文件只关心段布局与保存 payload，不渲染真实包清单。 */
export const emptyRuntimeStatus = {
  dataRoot: "/app/data",
  runtimeRoot: "/app/data/python-runtime",
  venvPath: "/app/data/python-runtime/venv",
  pythonPath: "/app/data/python-runtime/venv/bin/python",
  ready: true,
  indexes: {
    indexUrl: "",
    extraIndexUrls: [],
    trustedHosts: [],
    autoInstallOnActivate: true,
    autoInstallOnMissing: true,
  },
  manualPackages: [],
  installedPackages: [],
  packageSources: [],
  activeDependencies: [],
  conflicts: [],
}

/** FeatureCard 的标题是 span（不是 heading），用它定位卡片的 <section> 根节点。 */
export function featureCardOf(title: string): HTMLElement {
  const card = screen.getByText(title).closest("section")
  if (!card) throw new Error(`未找到功能卡: ${title}`)
  return card as HTMLElement
}
