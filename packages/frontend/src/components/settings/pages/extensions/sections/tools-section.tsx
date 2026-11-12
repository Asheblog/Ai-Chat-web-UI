"use client"

import { PythonRuntimeCard } from "@/components/settings/pages/tools-extensions/python-runtime-card"
import { PythonToolsCard } from "@/components/settings/pages/tools-extensions/python-tools-card"
import { SectionFrame } from "./section-frame"
import { useSectionSettings } from "./use-section-settings"

/**
 * 能力扩展 · 内置工具段：Python 工具卡（主开关 + 超时/stdout/代码长度 + 迭代上限）
 * 与 Python 运行时管理卡（纯 API 驱动，自身状态自管）。
 *
 * 取数、三态阶梯与段头样式由 useSectionSettings + SectionFrame 统一持有，本文件只剩段 key
 * 与卡片列表。卡保持受控（settings + update 从段内传入），切段（keep-alive）不会各自再发一遍
 * 设置请求；动态 Skill Runtime 开关也不在本段，它由 Skill 段页头唯一持有。
 */
export function ToolsSection(): JSX.Element {
  const state = useSectionSettings()

  return (
    <SectionFrame sectionKey="tools" state={state}>
      {({ settings, update }) => (
        <>
          <PythonToolsCard settings={settings} update={update} />
          <PythonRuntimeCard />
        </>
      )}
    </SectionFrame>
  )
}
