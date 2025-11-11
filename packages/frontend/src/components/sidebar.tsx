'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, Settings, Trash2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
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
import { useChatStore } from '@/store/chat-store'
import { useSettingsStore } from '@/store/settings-store'
import { formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { SettingsDialog } from '@/components/settings/settings-dialog'
import { SidebarToggleIcon } from '@/components/sidebar-toggle-icon'
import { useAuthStore } from '@/store/auth-store'
import { useModelsStore } from '@/store/models-store'
import { useModelPreferenceStore, findPreferredModel, persistPreferredModel } from '@/store/model-preference-store'
import { sessionItemVariants, sessionListVariants } from '@/lib/animations'

export function Sidebar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  // 修复：新建会话并发点击导致重复创建与延迟弹出（添加本地创建中锁）
  const [isCreating, setIsCreating] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const {
    sessions,
    currentSession,
    messageMetas,
    fetchSessions,
    selectSession,
    deleteSession,
    createSession,
    sessionUsageTotalsMap,
    isSessionsLoading,
  } = useChatStore()
  const { systemSettings, sidebarCollapsed, setSidebarCollapsed, publicBrandText } = useSettingsStore()
  const { actorState, quota } = useAuthStore((state) => ({ actorState: state.actorState, quota: state.quota }))
  const { models, fetchAll } = useModelsStore()
  const preferredModel = useModelPreferenceStore((state) => state.preferred)

  const isAnonymous = actorState !== 'authenticated'
  const quotaRemaining = quota?.unlimited
    ? Infinity
    : quota?.remaining ?? (quota ? Math.max(0, quota.dailyLimit - quota.usedCount) : null)
  const quotaExhausted = Boolean(isAnonymous && quota && quotaRemaining !== null && quotaRemaining <= 0)
  const quotaDisplay = quota?.unlimited ? '无限' : Math.max(0, quotaRemaining ?? 0)
  const searchParams = useSearchParams()
  const router = useRouter()

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

  useEffect(() => {
    const openSettings = () => setIsSettingsOpen(true)
    if (typeof window !== 'undefined') {
      window.addEventListener('aichat:open-settings', openSettings)
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('aichat:open-settings', openSettings)
      }
    }
  }, [])

  const handleNewChat = async () => {
    if (isCreating || quotaExhausted) return
    setIsCreating(true)
    try {
      let available = models
      if (!available || available.length === 0) {
        await fetchAll()
        available = useModelsStore.getState().models
      }

      const resolved = findPreferredModel(available || [], preferredModel) || available?.[0]
      if (!resolved) {
        setIsCreating(false)
        return
      }

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
      const localCount = cur ? messageMetas.length : 0
      const definitelyEmpty = Boolean(cur && isDefaultTitle && localCount === 0 && (serverCount === null || serverCount === 0))
      if (definitelyEmpty) {
        // 直接返回，复用当前空白会话
        if (cur?.id) {
          router.push(`/main/${cur.id}`)
        }
        setIsMobileMenuOpen(false)
        return
      }

      const created = await createSession(
        resolved.id,
        '新的对话',
        resolved.connectionId ?? undefined,
        resolved.rawId ?? undefined
      )
      if (created?.id) {
        router.push(`/main/${created.id}`)
      }
      void persistPreferredModel(resolved, { actorType: isAnonymous ? 'anonymous' : 'user' })
      setIsMobileMenuOpen(false)
    } catch (error) {
      console.error('Failed to create session:', error)
    } finally {
      setIsCreating(false)
    }
  }

  const handleSessionClick = (sessionId: number) => {
    selectSession(sessionId)
    router.push(`/main/${sessionId}`)
    setIsMobileMenuOpen(false)
  }

  const requestDeleteSession = (sessionId: number, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeleteTargetId(sessionId)
  }

  // 将标题限制在 15 个字符以内（按 Unicode 码点计数），超出添加省略号
  const clipTitle = (s: string, max = 15) => {
    try {
      const arr = Array.from(s || '')
      return arr.length > max ? arr.slice(0, max).join('') + '…' : s
    } catch { return s }
  }

  const sidebarContent = (
    <div className="flex h-full w-full lg:w-72 flex-col bg-slate-50 dark:bg-slate-900 dark:text-slate-100">
      {/* 顶部文字LOGO + 折叠按钮 */}
      <div className="px-4 pt-[10px] pb-2 flex items-center justify-between">
        <Link href="/main" className="block flex-1 select-none text-center">
          <span className="text-lg font-semibold tracking-tight">
            {(systemSettings?.brandText ?? publicBrandText ?? '').trim() || 'AIChat'}
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="折叠侧边栏"
            className="inline-flex lg:hidden h-10 w-10 rounded-full border border-slate-200/70 hover:bg-slate-200 dark:border-slate-800/70 dark:hover:bg-slate-800/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-colors"
            onClick={() => {
              setSidebarCollapsed(true)
              setIsMobileMenuOpen(false)
            }}
          >
            <SidebarToggleIcon className="h-6 w-6" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="收起侧边栏"
            className="hidden lg:inline-flex ml-2 hover:bg-slate-200 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-colors"
            onClick={() => setSidebarCollapsed(true)}
          >
            <SidebarToggleIcon className="h-6 w-6" />
          </Button>
        </div>
      </div>

      {/* 顶部新建聊天按钮 */}
      <div className="px-4 pb-4 space-y-2">
        <Button
          onClick={handleNewChat}
          className="w-full justify-start text-foreground hover:bg-slate-100 dark:hover:bg-slate-800 border-0 shadow-none bg-transparent"
          variant="ghost"
          disabled={isCreating || quotaExhausted}
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
        <Button
          onClick={() => setIsSettingsOpen(true)}
          className="w-full justify-start text-foreground hover:bg-slate-100 dark:hover:bg-slate-800 border-0 shadow-none bg-transparent"
          variant="ghost"
        >
          <Settings className="mr-2 h-4 w-4" />
          系统设置
        </Button>
      </div>
      {quotaExhausted && (
        <div className="px-4 pb-4">
          <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 px-3 py-2 text-xs text-muted-foreground space-y-1">
            <p>今日匿名额度已用尽。</p>
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => {
                try { window.location.href = '/auth/login' } catch {}
              }}
            >
              登录后即可继续对话
            </button>
          </div>
        </div>
      )}

      <div className="px-4 pb-4">
        <div className="border-t border-slate-200 dark:border-slate-800" />
      </div>
      {/* 会话列表 */}
      <ScrollArea className="flex-1 px-4">
        <div className="space-y-2">
          {/* 加载骨架 */}
          {isSessionsLoading && sessions.length === 0 && (
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
          {!isSessionsLoading && sessions.length === 0 && (
            <div className="text-center text-muted-foreground py-6">
              <p>暂无会话</p>
            </div>
          )}

          <motion.div variants={sessionListVariants} initial={false} animate="animate">
            <AnimatePresence mode="popLayout">
              {sessions.map((session) => (
                <motion.div
                  key={session.id}
                  variants={sessionItemVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  layout
                  className={cn(
                    "group relative flex items-center justify-between rounded-lg p-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors",
                    currentSession?.id === session.id && "bg-slate-100 dark:bg-slate-800"
                  )}
                  onClick={() => handleSessionClick(session.id)}
                  whileHover={{ x: 4 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 25 }}
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
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        </div>
      </ScrollArea>

    </div>
  )

  const collapsedSidebar = (
    <div className="flex h-full w-14 flex-col items-center justify-start bg-slate-50 dark:bg-slate-900 dark:text-slate-100 py-3">
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
        <div
          className={cn(
            "relative h-full overflow-hidden transition-[width] duration-300 ease-in-out bg-slate-50 dark:bg-slate-900 will-change-[width]",
            sidebarCollapsed ? "w-14" : "w-72"
          )}
        >
          <div
            className={cn(
              "absolute inset-0 transition-all duration-300 ease-in-out",
              sidebarCollapsed
                ? "-translate-x-4 opacity-0 pointer-events-none"
                : "translate-x-0 opacity-100 pointer-events-auto"
            )}
          >
            {sidebarContent}
          </div>
          <div
            className={cn(
              "absolute inset-0 transition-all duration-300 ease-in-out",
              sidebarCollapsed
                ? "translate-x-0 opacity-100 pointer-events-auto"
                : "translate-x-4 opacity-0 pointer-events-none"
            )}
          >
            {collapsedSidebar}
          </div>
        </div>
      </div>

      {/* 移动端侧边栏：Sheet */}
      <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="w-72 border-r border-slate-200/70 dark:border-slate-800/70 bg-slate-50 dark:bg-slate-900 p-0 data-[state=closed]:duration-300 data-[state=open]:duration-300"
        >
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
                    try {
                      const wasCurrent = useChatStore.getState().currentSession?.id === id
                      await deleteSession(id)
                      if (wasCurrent) {
                        const state = useChatStore.getState()
                        if (state.currentSession?.id) {
                          router.replace(`/main/${state.currentSession.id}`)
                        } else if (state.sessions.length > 0) {
                          const nextId = state.sessions[0].id
                          state.selectSession(nextId)
                          router.replace(`/main/${nextId}`)
                        } else {
                          router.replace('/main')
                        }
                      }
                    } catch (e) { console.error(e) }
                  }
                }}
              >确定</Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {sidebarCollapsed && !isMobileMenuOpen && (
        <div
          className="lg:hidden fixed left-4 z-40"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)' }}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="展开侧边栏"
            className="h-12 w-12 rounded-full border border-slate-200/80 dark:border-slate-800/80 bg-background/95 shadow-lg hover:bg-accent/70 dark:hover:bg-slate-800/80"
            onClick={() => {
              setSidebarCollapsed(false)
              setIsMobileMenuOpen(true)
            }}
          >
            <SidebarToggleIcon className="h-6 w-6" />
          </Button>
        </div>
      )}
    </>
  )
}

export function SidebarSettingsDialogBridge() {
  // 保留一个便于测试的导出（若需要在其他地方打开设置）
  return null
}
