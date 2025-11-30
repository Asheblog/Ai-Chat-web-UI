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
    <div className="space-y-6">
      <PersonalPreferencesPage />
      <PersonalSecurityPage />
      <ShareManagementPanel />
    </div>
  )
}

export default PersonalSettings
