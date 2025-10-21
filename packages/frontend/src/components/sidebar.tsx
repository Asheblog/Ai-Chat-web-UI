'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Plus, Settings, LogOut, Moon, Sun, Monitor, User, Menu, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuthStore } from '@/store/auth-store'
import { useChatStore } from '@/store/chat-store'
import { useSettingsStore } from '@/store/settings-store'
import { formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'

export function Sidebar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const { user, logout } = useAuthStore()
  const { sessions, currentSession, messages, fetchSessions, selectSession, deleteSession, createSession, sessionUsageTotalsMap } = useChatStore()
  const { theme, setTheme, systemSettings } = useSettingsStore()

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  const handleNewChat = async () => {
    if (!systemSettings?.systemModels || systemSettings.systemModels.length === 0) {
      return
    }

    try {
      // 若当前会话“完全空白”，则不创建新会话（与 ChatGPT 等产品一致）
      // 判断标准：
      // 1) 当前会话存在；
      // 2) 本地消息列表为空；
      // 3) 标题为空或默认；
      // 4)（可选）服务端统计为 0 条消息时更可信。
      const cur = currentSession
      const isDefaultTitle = !!cur && (
        !cur.title || cur.title.trim() === '' || cur.title === '新的对话' || cur.title === 'New Chat'
      )
      const serverCount = cur ? (sessions.find(s => s.id === cur.id)?._count?.messages ?? null) : null
      const definitelyEmpty = cur && isDefaultTitle && messages.length === 0 && (serverCount === null || serverCount === 0)
      if (definitelyEmpty) {
        // 直接返回，复用当前空白会话
        setIsMobileMenuOpen(false)
        return
      }

      await createSession(systemSettings.systemModels[0].id, '新的对话')
      setIsMobileMenuOpen(false)
    } catch (error) {
      console.error('Failed to create session:', error)
    }
  }

  const handleSessionClick = (sessionId: number) => {
    selectSession(sessionId)
    setIsMobileMenuOpen(false)
  }

  const handleDeleteSession = async (sessionId: number, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await deleteSession(sessionId)
    } catch (error) {
      console.error('Failed to delete session:', error)
    }
  }

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme)
  }

  const sidebarContent = (
    <div className="flex h-full w-64 flex-col bg-card border-r">
      {/* 顶部文字LOGO */}
      <div className="px-4 pt-4 pb-2 flex items-center justify-center">
        <Link href="/main" className="block select-none text-center">
          <span className="text-lg font-semibold tracking-tight">
            {systemSettings?.brandText || 'AIChat'}
          </span>
        </Link>
      </div>

      {/* 顶部新建聊天按钮 */}
      <div className="px-4 pb-4">
        <Button
          onClick={handleNewChat}
          className="w-full justify-start"
          variant="outline"
        >
          <Plus className="mr-2 h-4 w-4" />
          新建聊天
        </Button>
      </div>

      {/* 会话列表 */}
      <ScrollArea className="flex-1 px-4">
        <div className="space-y-2">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={cn(
                "group relative flex items-center justify-between rounded-lg p-3 cursor-pointer hover:bg-muted transition-colors",
                currentSession?.id === session.id && "bg-muted"
              )}
              onClick={() => handleSessionClick(session.id)}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {session.title}
                </p>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {formatDate(session.createdAt)}
                  </p>
                  {sessionUsageTotalsMap?.[session.id] && (
                    <p className="text-[10px] text-muted-foreground whitespace-nowrap">
                      t{sessionUsageTotalsMap[session.id].total_tokens}
                    </p>
                  )}
                </div>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => handleDeleteSession(session.id, e)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* 底部用户菜单 */}
      <div className="border-t p-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="w-full justify-start">
              <Avatar className="h-6 w-6 mr-2">
                <AvatarImage src={undefined} />
                <AvatarFallback className="text-xs">
                  {user?.username?.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="truncate">{user?.username}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem asChild>
              <Link href="/main/settings" className="flex items-center">
                <Settings className="mr-2 h-4 w-4" />
                设置
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => handleThemeChange('light')}>
              <Sun className="mr-2 h-4 w-4" />
              浅色模式
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleThemeChange('dark')}>
              <Moon className="mr-2 h-4 w-4" />
              深色模式
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleThemeChange('system')}>
              <Monitor className="mr-2 h-4 w-4" />
              跟随系统
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="text-destructive">
              <LogOut className="mr-2 h-4 w-4" />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )

  return (
    <>
      {/* 移动端菜单按钮 */}
      <div className="lg:hidden fixed top-4 left-4 z-50">
        <Button
          variant="outline"
          size="icon"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        >
          {isMobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </Button>
      </div>

      {/* 移动端侧边栏覆盖层 */}
      {isMobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/50"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* 桌面端侧边栏 */}
      <div className="hidden lg:flex">
        {sidebarContent}
      </div>

      {/* 移动端侧边栏 */}
      {isMobileMenuOpen && (
        <div className="lg:hidden fixed inset-y-0 left-0 z-50">
          {sidebarContent}
        </div>
      )}
    </>
  )
}
