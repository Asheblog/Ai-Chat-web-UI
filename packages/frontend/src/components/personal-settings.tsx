"use client"
// UTF-8，无 BOM
// 个人设置聚合组件：最小化改动以恢复生产构建
// 组合已有页面片段，避免在构建期引入新的类型依赖

import React from "react"
import { PersonalPreferencesPage } from "@/components/settings/pages/PersonalPreferences"
import { PersonalSecurityPage } from "@/components/settings/pages/PersonalSecurity"
import { ShareManagementPanel } from "@/components/settings/pages/ShareManagement"

export function PersonalSettings() {
  return (
    <div className="space-y-3">
      <div id="settings-personal-preferences" className="scroll-mt-6">
        <PersonalPreferencesPage />
      </div>
      <div id="settings-personal-security" className="scroll-mt-6">
        <PersonalSecurityPage />
      </div>
      <div id="settings-share-management" className="scroll-mt-6">
        <ShareManagementPanel />
      </div>
    </div>
  )
}

export default PersonalSettings
