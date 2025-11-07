"use client"
// UTF-8，无 BOM
// 系统设置聚合组件：集中展示系统相关设置分区

import React from "react"
import { SystemGeneralPage } from "@/components/settings/pages/SystemGeneral"
import { SystemNetworkPage } from "@/components/settings/pages/SystemNetwork"
import { SystemReasoningPage } from "@/components/settings/pages/SystemReasoning"
import { SystemWebSearchPage } from "@/components/settings/pages/SystemWebSearch"
import { SystemModelsPage } from "@/components/settings/pages/SystemModels"
import { SystemConnectionsPage } from "@/components/settings/pages/SystemConnections"
import { SystemUsersPage } from "@/components/settings/pages/SystemUsers"
import { AboutPage } from "@/components/settings/pages/About"

export function SystemSettings() {
  return (
    <div className="space-y-6">
      <SystemGeneralPage />
      <SystemNetworkPage />
      <SystemWebSearchPage />
      <SystemReasoningPage />
      <SystemModelsPage />
      <SystemConnectionsPage />
      <SystemUsersPage />
      <AboutPage />
    </div>
  )
}

export default SystemSettings
