"use client"

import {
  SegmentedTabs,
  segmentPanelId,
  segmentTabId,
  type SegmentedTabItem,
} from "@/components/settings/components/segmented-tabs"
import { SkillApprovalsSection } from "@/components/settings/pages/system-skills/SkillApprovalsSection"
import { SkillBindingsSection } from "@/components/settings/pages/system-skills/SkillBindingsSection"
import { SkillVersionSection } from "@/components/settings/pages/system-skills/SkillVersionSection"
import { useSkillsGovernance } from "@/features/skills/use-skills-governance"
import { EXTENSION_SEGMENTS } from "../extensions-sections"
import { SectionHeader } from "./section-frame"
import { SectionSwitch } from "./section-switch"
import { SkillInstallPanel } from "./skill-install-panel"
import { SkillUninstallDialog } from "./skill-uninstall-dialog"

/**
 * 能力扩展 · Skill 段：段页头（动态 Skill Runtime 开关）+ 4 个次级标签。
 *
 * 原 `SkillsGovernancePage` 的页面壳在此收口：三 section 改成受控子组件按标签切换，
 * 安装表单改用既有 `SkillInstallSection`，卸载预览 Dialog 一并迁入。业务逻辑全部在
 * `useSkillsGovernance` 里，本组件只做布局与 props 传递（toast 与禁用态未改）。
 * 页头开关由 SectionSwitch 承担，与 MCP 段同一份三态实现。
 */

/** Skill 段次级标签顺序：安装 → 待审批 → 版本 → 绑定。 */
const SKILL_SEGMENTS = ["install", "approvals", "versions", "bindings"] as const

export type SkillSegment = (typeof SKILL_SEGMENTS)[number]

export function isSkillSegment(value: string | undefined): value is SkillSegment {
  return typeof value === "string" && (SKILL_SEGMENTS as readonly string[]).includes(value)
}

/** 标签/面板 id 前缀：keep-alive 下 MCP 段的同名标签同时在册，id 必须带段前缀才唯一。 */
const TAB_PREFIX = "skill-tab"

export function SkillSection({
  segment,
  onSegmentChange,
}: {
  /** 次级标签由页面持有：卡定位/搜索需要先切段再交给 SystemLeafWrapper 滚动。 */
  segment: SkillSegment
  onSegmentChange: (segment: SkillSegment) => void
}): JSX.Element {
  const {
    loading,
    catalog,
    bindings,
    approvals,
    versionActionKey,
    skillActionKey,
    approvalActionId,
    bindingSubmitting,
    binding,
    uninstall,
    actions,
  } = useSkillsGovernance()

  /** 标签文案的单一来源是 extensions-sections 的段配置；待审批数量就地挂成徽标。 */
  const tabs: SegmentedTabItem<SkillSegment>[] = SKILL_SEGMENTS.map((key) => ({
    key,
    label: EXTENSION_SEGMENTS.skills.find((item) => item.key === key)?.label ?? key,
    badge: key === "approvals" && approvals.length > 0 ? String(approvals.length) : undefined,
  }))

  const deleting = Boolean(
    uninstall.preview && skillActionKey === `delete:${uninstall.preview.skillId}`,
  )

  return (
    <div className="space-y-3">
      <SectionHeader
        sectionKey="skills"
        aside={
          <SectionSwitch
            settingsKey="chatDynamicSkillRuntimeEnabled"
            label="运行时"
            onLabel="已开启"
            offLabel="已关闭"
            ariaLabel="动态 Skill Runtime 开关"
            hint="开启后聊天可直接调度已安装并绑定的第三方 Skill"
          />
        }
      />

      <SegmentedTabs
        items={tabs}
        active={segment}
        onChange={onSegmentChange}
        ariaLabel="Skill 次级标签"
        idPrefix={TAB_PREFIX}
      />

      <div
        data-card-key={`extensions:skill-${segment}`}
        id={segmentPanelId(TAB_PREFIX, segment)}
        role="tabpanel"
        aria-labelledby={segmentTabId(TAB_PREFIX, segment)}
      >
        {segment === "install" ? (
          <SkillInstallPanel />
        ) : segment === "approvals" ? (
          <SkillApprovalsSection
            loading={loading}
            approvals={approvals}
            approvalActionId={approvalActionId}
            onRespondApproval={actions.respondApproval}
          />
        ) : segment === "versions" ? (
          <SkillVersionSection
            loading={loading}
            catalog={catalog}
            versionActionKey={versionActionKey}
            skillActionKey={skillActionKey}
            onApproveVersion={actions.approveVersion}
            onActivateVersion={actions.activateVersion}
            onUninstallSkill={actions.requestUninstall}
          />
        ) : (
          <SkillBindingsSection
            catalog={catalog}
            bindings={bindings}
            versionOptions={binding.versionOptions}
            bindingSkillId={binding.skillId}
            bindingVersionId={binding.versionId}
            bindingScopeType={binding.scopeType}
            bindingScopeId={binding.scopeId}
            bindingEnabled={binding.enabled}
            bindingPolicyDraft={binding.policyDraft}
            bindingOverridesDraft={binding.overridesDraft}
            bindingSubmitting={bindingSubmitting}
            onBindingSkillIdChange={actions.setBindingSkillId}
            onBindingVersionIdChange={actions.setBindingVersionId}
            onBindingScopeTypeChange={actions.setBindingScopeType}
            onBindingScopeIdChange={actions.setBindingScopeId}
            onBindingEnabledChange={actions.setBindingEnabled}
            onBindingPolicyDraftChange={actions.setBindingPolicyDraft}
            onBindingOverridesDraftChange={actions.setBindingOverridesDraft}
            onUpsertBinding={actions.upsertBinding}
            onDeleteBinding={actions.deleteBinding}
          />
        )}
      </div>

      <SkillUninstallDialog
        open={uninstall.dialogOpen}
        preview={uninstall.preview}
        deleting={deleting}
        onOpenChange={actions.setUninstallDialogOpen}
        onConfirm={actions.confirmUninstall}
      />
    </div>
  )
}
