'use client'
export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { SettingsShell, SettingsSection } from '@/components/settings/shell'
import { PersonalSettings } from '@/components/personal-settings'
import { SystemSettings } from '@/components/system-settings'
import { useAuthStore } from '@/store/auth-store'

export default function MobileSettingsPage() {
  const { user } = useAuthStore()
  const [activeTab, setActiveTab] = useState('personal')

  useEffect(() => {
    if (user?.role === 'ADMIN') setActiveTab('system')
    else setActiveTab('personal')
  }, [user])

  const sections: SettingsSection[] = [
    { key: 'personal', label: '个人设置' },
    ...(user?.role === 'ADMIN' ? ([{ key: 'system', label: '系统设置' }] as SettingsSection[]) : []),
  ]

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="border-b bg-background px-4 py-3">
        <div className="flex items-center gap-4">
          <Link href="/m/main">
            <Button variant="ghost" size="icon" aria-label="返回">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-lg font-semibold">设置</h1>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4 min-h-0">
        <SettingsShell
          title="设置"
          sections={sections}
          active={activeTab}
          onChange={setActiveTab}
        >
          {activeTab === 'system' && user?.role === 'ADMIN' ? (
            <SystemSettings />
          ) : (
            <PersonalSettings />
          )}
        </SettingsShell>
      </div>
    </div>
  )
}

