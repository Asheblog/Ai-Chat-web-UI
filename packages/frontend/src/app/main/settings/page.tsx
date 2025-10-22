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

export default function SettingsPage() {
  const { user } = useAuthStore()
  const [activeTab, setActiveTab] = useState('personal')

  useEffect(() => {
    // 如果是管理员，默认显示系统设置，否则显示个人设置
    if (user?.role === 'ADMIN') {
      setActiveTab('system')
    } else {
      setActiveTab('personal')
    }
  }, [user])

  const sections: SettingsSection[] = [
    { key: 'personal', label: '个人设置' },
    ...(user?.role === 'ADMIN' ? [{ key: 'system', label: '系统设置' }] as SettingsSection[] : []),
  ]

  return (
    // 主容器：最小高度为0，避免子项溢出时丢失滚动条
    <div className="flex-1 flex flex-col min-h-0">
      {/* 顶部导航栏（非吸顶） */}
      <div className="border-b bg-background px-4 py-3">
        <div className="flex items-center gap-4">
          <Link href="/main">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-lg font-semibold">设置</h1>
        </div>
      </div>

      {/* 内容区域：侧栏+右侧内容 */}
      <div className="flex-1 overflow-auto p-6 min-h-0">
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
