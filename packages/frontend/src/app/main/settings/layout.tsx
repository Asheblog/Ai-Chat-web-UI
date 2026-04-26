import { ReactNode } from "react"
import { SettingsLayoutClient } from "./_components/settings-layout-client"

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SettingsLayoutClient>{children}</SettingsLayoutClient>
    </div>
  )
}
