import { ReactNode } from "react"
import { SystemSettingsLayoutClient } from "./_components/system-settings-layout-client"

export default function SystemSettingsLayout({ children }: { children: ReactNode }) {
  return <SystemSettingsLayoutClient>{children}</SystemSettingsLayoutClient>
}
