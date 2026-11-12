"use client"

import { BattleCard } from "@/components/settings/pages/tools-extensions/battle-card"
import { TitleSummaryCard } from "@/components/settings/pages/tools-extensions/title-summary-card"
import { SectionFrame } from "./section-frame"
import { useSectionSettings } from "./use-section-settings"

/**
 * 能力扩展 · 对话增强段：模型大乱斗（battle*）与标题智能总结（titleSummary*）。
 *
 * 与内置工具段同一套取数方式：段壳持三态，两张卡保持受控（settings + update 从外部
 * 传入），各自只提交自己那几个 key。段头文案同样来自 EXTENSION_SECTIONS。
 */
export function ExtraSection(): JSX.Element {
  const state = useSectionSettings()

  return (
    <SectionFrame sectionKey="extra" state={state}>
      {({ settings, update }) => (
        <>
          <BattleCard settings={settings} update={update} />
          <TitleSummaryCard settings={settings} update={update} />
        </>
      )}
    </SectionFrame>
  )
}
