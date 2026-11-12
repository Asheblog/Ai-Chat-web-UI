"use client"

import { useCallback, useEffect, useId, useState } from "react"
import { Puzzle } from "lucide-react"
import { SegmentedTabs, type SegmentedTabItem } from "@/components/settings/components/segmented-tabs"
import { SkillApprovalsSection } from "@/components/settings/pages/system-skills/SkillApprovalsSection"
import { SkillBindingsSection } from "@/components/settings/pages/system-skills/SkillBindingsSection"
import { SkillVersionSection } from "@/components/settings/pages/system-skills/SkillVersionSection"
import { Switch } from "@/components/ui/switch"
import { useSkillsGovernance } from "@/features/skills/use-skills-governance"
import { useSystemSettings } from "@/hooks/use-system-settings"
import { EXTENSION_SEGMENTS } from "../extensions-sections"
import { SkillInstallPanel } from "./skill-install-panel"
import { SkillUninstallDialog } from "./skill-uninstall-dialog"

/**
 * 能力扩展 · Skill 段：段页头（动态 Skill Runtime 开关）+ 4 个次级标签。
 *
 * 原 `SkillsGovernancePage` 的页面壳在此收口：三 section 改成受控子组件按标签切换，
 * 安装表单改用既有 `SkillInstallSection`，卸载预览 Dialog 一并迁入。业务逻辑全部在
 * `useSkillsGovernance` 里，本组件只做布局与 props 传递（toast 与禁用态未改）。
 */

/** Skill 段次级标签顺序：安装 → 待审批 → 版本 → 绑定。 */
const SKILL_SEGMENTS = ["install", "approvals", "versions", "bindings"] as const

export type SkillSegment = (typeof SKILL_SEGMENTS)[number]

export function isSkillSegment(value: string | undefined): value is SkillSegment {
  return typeof value === "string" && (SKILL_SEGMENTS as readonly string[]).includes(value)
}

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

  // 开关走共享 settings store（不是裸 API）：同页总览与 Python 卡读同一份状态，切段不会看到过期值。
  const { settings, update, refresh, isLoading, error } = useSystemSettings()
  const [saving, setSaving] = useState(false)
  const switchId = useId()
  // 未取到设置时不猜「未开启」：显示状态未知并提供重试，与 McpSection 保持同构。
  const enabled = settings ? Boolean(settings.chatDynamicSkillRuntimeEnabled) : null

  useEffect(() => {
    if (settings) return
    void refresh().catch(() => {})
  }, [settings, refresh])

  const handleToggle = useCallback(
    async (next: boolean) => {
      setSaving(true)
      try {
        await update({ chatDynamicSkillRuntimeEnabled: next })
      } catch {
        // 开关值直接来自 store：写入失败时 store 不变，UI 自动回到原状态
      } finally {
        setSaving(false)
      }
    },
    [update],
  )

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
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-3">
        <div className="min-w-0 space-y-1">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Puzzle className="h-4 w-4 text-muted-foreground" aria-hidden />
            Skill
          </h2>
          <p className="text-sm text-muted-foreground text-pretty">安装、审批与绑定第三方 Skill</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <Switch
              id={switchId}
              checked={enabled === true}
              onCheckedChange={handleToggle}
              disabled={saving || settings === null || isLoading}
              aria-label="动态 Skill Runtime 开关"
            />
            <label
              htmlFor={switchId}
              className="cursor-pointer select-none text-xs text-muted-foreground"
            >
              运行时 {enabled === null ? "状态未知" : enabled ? "已开启" : "未开启"}
            </label>
            {saving && <span className="text-xs text-muted-foreground/60">保存中...</span>}
            {enabled === null && !isLoading ? (
              <button
                type="button"
                onClick={() => void refresh().catch(() => {})}
                className="text-xs text-primary underline-offset-2 hover:underline"
              >
                重试
              </button>
            ) : null}
          </div>
          {enabled === null && error ? (
            <p className="text-micro text-destructive">{error}</p>
          ) : null}
          <p className="text-micro text-muted-foreground/80">
            开启后聊天可直接调度已安装并绑定的第三方 Skill
          </p>
        </div>
      </div>

      <SegmentedTabs
        items={tabs}
        active={segment}
        onChange={onSegmentChange}
        ariaLabel="Skill 次级标签"
      />

      <div data-card-key={`extensions:skill-${segment}`}>
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
