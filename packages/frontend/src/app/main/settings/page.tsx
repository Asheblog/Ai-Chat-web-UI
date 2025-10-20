'use client'
export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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

  return (
    <div className="flex-1 flex flex-col">
      {/* 顶部导航栏 */}
      <div className="border-b px-4 py-3">
        <div className="flex items-center gap-4">
          <Link href="/main">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-lg font-semibold">设置</h1>
        </div>
      </div>

      {/* 设置内容 */}
      <div className="flex-1 p-6 overflow-auto">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="max-w-4xl mx-auto">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="personal">个人设置</TabsTrigger>
            {user?.role === 'ADMIN' && (
              <TabsTrigger value="system">系统设置</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="personal" className="mt-6">
            <PersonalSettings />
          </TabsContent>

          {user?.role === 'ADMIN' && (
            <TabsContent value="system" className="mt-6">
              <SystemSettings />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  )
}
