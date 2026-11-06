"use client"
// UTF-8，无 BOM
// 个人设置聚合组件：最小化改动以恢复生产构建
// 组合已有页面片段，避免在构建期引入新的类型依赖

import React from "react"
import dynamic from "next/dynamic"
import {
  getPersonalSectionAnchor,
  type PersonalSettingsSection,
} from "@/components/settings/personal-section"

export { resolvePersonalSectionFromHash, getPersonalSectionAnchor } from "@/components/settings/personal-section"
export type { PersonalSettingsSection } from "@/components/settings/personal-section"

const leafLoading = () => (
  <div className="v2-panel-soft p-6 text-sm text-muted-foreground">正在加载个人设置…</div>
)

const PersonalPreferencesPage = dynamic(
  () => import("@/components/settings/pages/PersonalPreferences").then((m) => m.PersonalPreferencesPage),
  { loading: leafLoading },
)
const PersonalSkillsPage = dynamic(
  () => import("@/components/settings/pages/PersonalSkills").then((m) => m.PersonalSkillsPage),
  { loading: leafLoading },
)
const ShareManagementPanel = dynamic(
  () => import("@/components/settings/pages/ShareManagement").then((m) => m.ShareManagementPanel),
  { loading: leafLoading },
)
const PersonalSecurityPage = dynamic(
  () => import("@/components/settings/pages/PersonalSecurity").then((m) => m.PersonalSecurityPage),
  { loading: leafLoading },
)

interface PersonalSettingsProps {
  activeSection?: PersonalSettingsSection
}

export function PersonalSettings({ activeSection = "profile" }: PersonalSettingsProps) {
  return (
    <div className="space-y-3">
      {activeSection === "profile" ? (
        <div id={getPersonalSectionAnchor("profile")} className="scroll-mt-6">
          <PersonalPreferencesPage />
        </div>
      ) : null}
      {activeSection === "skills" ? (
        <div id={getPersonalSectionAnchor("skills")} className="scroll-mt-6">
          <PersonalSkillsPage />
        </div>
      ) : null}
      {activeSection === "shares" ? (
        <div id={getPersonalSectionAnchor("shares")} className="scroll-mt-6">
          <ShareManagementPanel />
        </div>
      ) : null}
      {activeSection === "security" ? (
        <div id={getPersonalSectionAnchor("security")} className="scroll-mt-6">
          <PersonalSecurityPage />
        </div>
      ) : null}
    </div>
  )
}

export default PersonalSettings
