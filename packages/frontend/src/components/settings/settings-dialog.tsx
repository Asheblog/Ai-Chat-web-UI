"use client"
import { useEffect, useState } from "react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { SettingsShell, SettingsSection } from "./shell"
import { useAuthStore } from "@/store/auth-store"
import { PersonalSettings } from "@/components/personal-settings"
import { SystemSettings } from "@/components/system-settings"

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultTab?: "personal" | "system"
}

export function SettingsDialog({ open, onOpenChange, defaultTab = "personal" }: SettingsDialogProps) {
  const { user } = useAuthStore()
  const [active, setActive] = useState<"personal" | "system">(defaultTab)

  useEffect(() => {
    // 若是管理员，默认展示系统设置，否则个人设置
    if (user?.role === 'ADMIN') setActive(defaultTab || 'system')
    else setActive('personal')
  }, [user?.role, defaultTab])

  const sections: SettingsSection[] = [
    { key: 'personal', label: '个人设置' },
    ...(user?.role === 'ADMIN' ? [{ key: 'system', label: '系统设置' }] as SettingsSection[] : []),
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1000px] w-[92vw] max-h-[85vh] p-0 sm:rounded-2xl border shadow-[0_24px_64px_rgba(0,0,0,0.18)] overflow-y-auto">
        <SettingsShell bare title="设置" sections={sections} active={active} onChange={(k) => setActive(k as any)}>
          {active === 'system' && user?.role === 'ADMIN' ? <SystemSettings /> : <PersonalSettings />}
        </SettingsShell>
      </DialogContent>
    </Dialog>
  )
}
