'use client'

import dynamic from "next/dynamic"
import { usePersonalSectionFromHash } from "@/components/settings/personal-section"

const PersonalSettings = dynamic(
  () => import("@/components/personal-settings").then((m) => m.PersonalSettings),
  {
    loading: () => (
      <div className="v2-panel-soft p-6 text-sm text-muted-foreground">正在加载个人设置…</div>
    ),
  },
)

export default function SettingsPersonalPage() {
  // 独立个人设置页以 URL hash 为唯一页签来源，保留 back/forward 与四个深链。
  const activeSection = usePersonalSectionFromHash()
  return <PersonalSettings activeSection={activeSection} />
}
