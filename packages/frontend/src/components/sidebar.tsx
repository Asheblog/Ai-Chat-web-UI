'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Plus, Settings, LogOut, Moon, Sun, Monitor, Trash2 } from 'lucide-react'
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
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useAuthStore } from '@/store/auth-store'
import { useChatStore } from '@/store/chat-store'
import { useSettingsStore } from '@/store/settings-store'
import { apiClient } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { SettingsDialog } from '@/components/settings/settings-dialog'
import { SidebarToggleIcon } from '@/components/sidebar-toggle-icon'

export function Sidebar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  // 修复：新建会话并发点击导致重复创建与延迟弹出（添加本地创建中锁）
  const [isCreating, setIsCreating] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const { user, logout } = useAuthStore()
  const { sessions, currentSession, messages, fetchSessions, selectSession, deleteSession, createSession, sessionUsageTotalsMap, isLoading } = useChatStore()
  const { theme, setTheme, systemSettings, sidebarCollapsed, setSidebarCollapsed } = useSettingsStore()
  const searchParams = useSearchParams()

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  // 监听全局事件以从外部打开/关闭移动端侧栏
  useEffect(() => {
    const open = () => setIsMobileMenuOpen(true)
    const close = () => setIsMobileMenuOpen(false)
    if (typeof window !== 'undefined') {
      window.addEventListener('aichat:sidebar-open', open)
      window.addEventListener('aichat:sidebar-close', close)
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('aichat:sidebar-open', open)
        window.removeEventListener('aichat:sidebar-close', close)
      }
    }
  }, [])

  // 深链：URL 带 settings=1 时自动打开
  useEffect(() => {
    if (searchParams?.get('settings') === '1') {
      setIsSettingsOpen(true)
    }
  }, [searchParams])

  const handleNewChat = async () => {
    if (isCreating) return
    setIsCreating(true)
    let defaultModelId: string | null = null
    let defaultConnectionId: number | null = null
    let defaultRawId: string | null = null
    try {
      const res = await apiClient.getAggregatedModels()
      const first = res?.data?.[0]
      defaultModelId = (first?.id as string) || null
      defaultConnectionId = (first?.connectionId as number) || null
      defaultRawId = (first?.rawId as string) || null
    } catch {}
    if (!defaultModelId) { setIsCreating(false); return }

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

      await createSession(defaultModelId, '新的对话', defaultConnectionId ?? undefined, defaultRawId ?? undefined)
      setIsMobileMenuOpen(false)
    } catch (error) {
      console.error('Failed to create session:', error)
    } finally {
      setIsCreating(false)
    }
  }

  const handleSessionClick = (sessionId: number) => {
    selectSession(sessionId)
    setIsMobileMenuOpen(false)
  }

  const requestDeleteSession = (sessionId: number, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeleteTargetId(sessionId)
  }

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme)
  }

  // 将标题限制在 15 个字符以内（按 Unicode 码点计数），超出添加省略号
  const clipTitle = (s: string, max = 15) => {
    try {
      const arr = Array.from(s || '')
      return arr.length > max ? arr.slice(0, max).join('') + '…' : s
    } catch { return s }
  }

  const sidebarContent = (
    <div className="flex h-full w-full lg:w-64 flex-col bg-card lg:border-r">
      {/* 顶部文字LOGO + 折叠按钮 */}
      <div className="px-4 pt-[10px] pb-2 flex items-center justify-between">
        <Link href="/main" className="block flex-1 select-none text-center">
          <span className="text-lg font-semibold tracking-tight">
            {systemSettings?.brandText || 'AIChat'}
          </span>
        </Link>
        <Button
          variant="ghost"
          size="icon"
          aria-label="收起侧边栏"
          className="hidden lg:inline-flex ml-2"
          onClick={() => setSidebarCollapsed(true)}
        >
          <SidebarToggleIcon className="h-6 w-6" />
        </Button>
      </div>

      {/* 顶部新建聊天按钮 */}
      <div className="px-4 pb-4">
        <Button
          onClick={handleNewChat}
          className="w-full justify-start"
          variant="outline"
          disabled={isCreating}
          aria-busy={isCreating}
        >
          {isCreating ? (
            // 微型 loading，兼容浅/深色
            <span className="mr-2 h-4 w-4 inline-block animate-spin rounded-full border-2 border-muted-foreground/40 border-t-muted-foreground" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}
          新建聊天
        </Button>
      </div>

      {/* 会话列表 */}
      <ScrollArea className="flex-1 px-4">
        <div className="space-y-2">
          {/* 加载骨架 */}
          {isLoading && sessions.length === 0 && (
            <>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="border rounded-lg p-3">
                  <div className="h-4 w-28 bg-muted animate-pulse rounded" />
                  <div className="mt-2 flex items-center justify-between">
                    <div className="h-3 w-16 bg-muted animate-pulse rounded" />
                    <div className="h-3 w-10 bg-muted animate-pulse rounded" />
                  </div>
                </div>
              ))}
            </>
          )}

          {/* 空态 */}
          {!isLoading && sessions.length === 0 && (
            <div className="text-center text-muted-foreground py-6">
              <p>暂无会话</p>
            </div>
          )}

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
                <p className="truncate text-sm font-medium" title={session.title}>
                  {clipTitle(session.title, 15)}
                </p>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {formatDate(session.createdAt)}
                  </p>
                  {sessionUsageTotalsMap?.[session.id] && (
                    <p className="text-[10px] text-muted-foreground whitespace-nowrap">
                      总计{sessionUsageTotalsMap[session.id].total_tokens}
                    </p>
                  )}
                </div>
              </div>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 sm:h-6 sm:w-6 text-destructive/80 hover:text-destructive hover:bg-destructive/10 opacity-70 sm:opacity-0 sm:group-hover:opacity-100 transition"
                      onClick={(e) => requestDeleteSession(session.id, e)}
                      aria-label="删除会话"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>删除会话</TooltipContent>
                </Tooltip>
              </TooltipProvider>
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
            <DropdownMenuItem onClick={() => setIsSettingsOpen(true)} className="flex items-center">
              <Settings className="mr-2 h-4 w-4" />
              设置
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

  const collapsedSidebar = (
    <div className="w-14 flex flex-col items-center justify-start bg-background py-3">
      <Button
        variant="ghost"
        size="icon"
        className="h-10 w-10"
        aria-label="展开侧边栏"
        onClick={() => setSidebarCollapsed(false)}
      >
        <SidebarToggleIcon className="h-6 w-6" />
      </Button>
    </div>
  )

  return (
    <>
      {/* 全局设置弹框 */}
      <SettingsDialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />

      {/* 顶栏按钮触发：通过全局事件在 MobileMainLayout 中调用 */}

      {/* 桌面端侧边栏 */}
      <div className="hidden lg:flex">
        {sidebarCollapsed ? collapsedSidebar : sidebarContent}
      </div>

      {/* 移动端侧边栏：Sheet */}
      <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
        <SheetContent side="left" className="p-0 w-72">
          {sidebarContent}
        </SheetContent>
      </Sheet>

      {/* 删除确认弹框 */}
      <AlertDialog open={deleteTargetId !== null} onOpenChange={(open)=>!open && setDeleteTargetId(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>删除会话</AlertDialogTitle>
          <AlertDialogDescription>此操作不可撤销，确定要删除该会话吗？</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline">取消</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                onClick={async ()=>{
                  const id = deleteTargetId
                  setDeleteTargetId(null)
                  if (typeof id === 'number') {
                    try { await deleteSession(id) } catch (e) { console.error(e) }
                  }
                }}
              >确定</Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function SidebarSettingsDialogBridge() {
  // 保留一个便于测试的导出（若需要在其他地方打开设置）
  return null
}
