'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Github, Pin, PinOff, Plus, Settings, Trash2, Trophy } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import { cn } from '@/lib/utils'
import type { UsageTotals } from '@/types'
import { SettingsDialog } from '@/components/settings/settings-dialog'
import { SidebarToggleIcon } from '@/components/sidebar-toggle-icon'
import { useAuthStore } from '@/store/auth-store'
import { useModelsStore } from '@/store/models-store'
import { useModelPreferenceStore, findPreferredModel, persistPreferredModel } from '@/store/model-preference-store'
import { sessionItemVariants, sessionListVariants } from '@/lib/animations/sidebar'
import { APP_VERSION, PROJECT_URL } from '@/lib/app-meta'

const formatUsageLine = (usage?: UsageTotals) => {
  if (!usage) return ''
  const formatTokens = (value?: number) => {
    const num = Number(value ?? 0)
    if (num >= 10000) return (num / 1000).toFixed(0) + 'k'
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k'
    return num.toLocaleString()
  }
  return `${formatTokens(usage.prompt_tokens)}/${formatTokens(usage.completion_tokens)}`
}

// 侧边栏时间显示：固定月/日/时:分，避免同日仅显示时间导致长度不一
const formatSidebarDate = (date: string | Date): string => {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}

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
    toggleSessionPin,
    sessionUsageTotalsMap,
    isSessionsLoading,
  } = useChatStore()
  const {
    systemSettings,
    sidebarCollapsed,
    setSidebarCollapsed,
    publicBrandText,
    fetchSystemSettings,
    fetchPublicBranding,
  } = useSettingsStore()
  const { actorState, quota } = useAuthStore((state) => ({ actorState: state.actorState, quota: state.quota }))
  const { models, fetchAll } = useModelsStore()
  const preferredModel = useModelPreferenceStore((state) => state.preferred)

  const isAnonymous = actorState !== 'authenticated'
  const hasRequestedBranding = useRef(false)
  const quotaRemaining = quota?.unlimited
    ? Infinity
    : quota?.remaining ?? (quota ? Math.max(0, quota.dailyLimit - quota.usedCount) : null)
  const quotaExhausted = Boolean(isAnonymous && quota && quotaRemaining !== null && quotaRemaining <= 0)
  const quotaDisplay = quota?.unlimited ? '无限' : Math.max(0, quotaRemaining ?? 0)
  const searchParams = useSearchParams()
  const settingsDeepLink = searchParams?.get('settings') === '1'
  const settingsDeepLinkHandledRef = useRef(false)
  const router = useRouter()

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  useEffect(() => {
    const brandText = (systemSettings?.brandText ?? publicBrandText ?? '').trim()
    if (brandText || hasRequestedBranding.current) return
    if (actorState === 'loading') return
    hasRequestedBranding.current = true
    if (actorState === 'authenticated') {
      fetchSystemSettings().catch(() => {
        hasRequestedBranding.current = false
      })
      return
    }
    fetchPublicBranding().catch(() => {
      hasRequestedBranding.current = false
    })
  }, [systemSettings, publicBrandText, actorState, fetchSystemSettings, fetchPublicBranding])

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
    if (!settingsDeepLink) {
      settingsDeepLinkHandledRef.current = false
      return
    }
    if (isSettingsOpen || settingsDeepLinkHandledRef.current) return
    settingsDeepLinkHandledRef.current = true
    setIsSettingsOpen(true)
  }, [settingsDeepLink, isSettingsOpen])

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

  // 将标题限制在 10 个字符以内（按 Unicode 码点计数），超出添加省略号
  const clipTitle = (s: string, max = 10) => {
    try {
      const arr = Array.from(s || '')
      return arr.length > max ? arr.slice(0, max).join('') + '…' : s
    } catch { return s }
  }

  const sidebarContent = (
    <div className="flex h-full w-full flex-col border-r border-border/70 bg-[hsl(var(--sidebar-bg))] text-foreground lg:w-72">
      {/* 顶部文字LOGO + 折叠按钮 */}
      <div className="flex items-center justify-between px-4 pb-2 pt-[10px]">
        <Link href="/main" className="block flex-1 select-none text-center">
          <span className="text-lg font-semibold tracking-tight bg-[linear-gradient(135deg,hsl(var(--hero-from)),hsl(var(--hero-to)))] bg-clip-text text-transparent">
            {(systemSettings?.brandText ?? publicBrandText ?? '').trim() || 'AIChat'}
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="折叠侧边栏"
            className="inline-flex h-10 w-10 rounded-full border border-border/70 bg-[hsl(var(--surface))/0.5] hover:bg-[hsl(var(--sidebar-hover))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-colors lg:hidden"
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
            className="ml-2 hidden bg-transparent hover:bg-[hsl(var(--sidebar-hover))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-colors lg:inline-flex"
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
          className="w-full justify-start border border-dashed border-border/70 bg-transparent text-foreground shadow-none hover:border-primary/60 hover:bg-[hsl(var(--sidebar-hover))]"
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
          onClick={() => {
            router.push('/main/battle')
            setIsMobileMenuOpen(false)
          }}
          className="w-full justify-start border-0 bg-transparent text-foreground shadow-none hover:bg-[hsl(var(--sidebar-hover))]"
          variant="ghost"
        >
          <Trophy className="mr-2 h-4 w-4" />
          模型大乱斗
        </Button>
        <Button
          onClick={() => setIsSettingsOpen(true)}
          className="w-full justify-start border-0 bg-transparent text-foreground shadow-none hover:bg-[hsl(var(--sidebar-hover))]"
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
        <div className="border-t border-border/70" />
      </div>
      {/* 会话列表 */}
      <ScrollArea className="flex-1 px-4 overflow-hidden">
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
                    "group relative flex cursor-pointer items-center justify-between rounded-xl border border-transparent p-3 transition-colors hover:bg-[hsl(var(--sidebar-hover))]",
                    currentSession?.id === session.id && "border-primary/20 bg-primary/10"
                  )}
                  onClick={() => handleSessionClick(session.id)}
                  whileHover={{ x: 4 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                >
                  <div className="min-w-0 flex-1 pr-1">
                    <p className="truncate text-sm font-medium flex items-center gap-1" title={session.title}>
                      {session.pinnedAt ? (
                        <Pin className="h-3.5 w-3.5 text-amber-500 shrink-0" aria-hidden="true" />
                      ) : null}
                      <span className="truncate">{clipTitle(session.title, 10)}</span>
                    </p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
                      <span className="truncate">{formatSidebarDate(session.createdAt)}</span>
                      {sessionUsageTotalsMap?.[session.id] && (
                        <>
                          <span className="opacity-60 shrink-0">·</span>
                          <span className="shrink-0">{formatUsageLine(sessionUsageTotalsMap[session.id])}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-amber-500/80 opacity-70 transition hover:bg-amber-500/10 hover:text-amber-500 sm:h-6 sm:w-6 sm:opacity-0 sm:group-hover:opacity-100"
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleSessionPin(session.id, !session.pinnedAt)
                            }}
                            aria-label={session.pinnedAt ? '取消置顶' : '置顶会话'}
                          >
                            {session.pinnedAt ? (
                              <PinOff className="h-4 w-4" />
                            ) : (
                              <Pin className="h-4 w-4" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{session.pinnedAt ? '取消置顶' : '置顶'}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive/80 opacity-70 transition hover:bg-destructive/10 hover:text-destructive sm:h-6 sm:w-6 sm:opacity-0 sm:group-hover:opacity-100"
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
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        </div>
      </ScrollArea>

      <div className="border-t border-border/70 bg-[hsl(var(--sidebar-bg))/0.6] px-4 pb-5 pt-4">
        <div className="rounded-xl border border-border/70 bg-[linear-gradient(135deg,hsl(var(--surface))/0.88,hsl(var(--background-alt))/0.65)] px-3 py-3 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="font-mono text-[11px] leading-none px-2 py-1">
                {APP_VERSION}
              </Badge>
              <span className="text-xs text-muted-foreground">当前版本</span>
            </div>
            <Link
              href={PROJECT_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <Github className="h-4 w-4" />
              <span>项目地址</span>
            </Link>
          </div>
        </div>
      </div>

    </div>
  )

  const collapsedSidebar = (
    <div className="flex h-full w-14 flex-col items-center justify-between border-r border-border/70 bg-[hsl(var(--sidebar-bg))] py-3 text-foreground">
      {/* 顶部：展开按钮 + 新建聊天 + 系统设置 */}
      <div className="flex flex-col items-center gap-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10"
                aria-label="展开侧边栏"
                onClick={() => setSidebarCollapsed(false)}
              >
                <SidebarToggleIcon className="h-6 w-6" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">展开侧边栏</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10"
                aria-label="新建聊天"
                onClick={handleNewChat}
                disabled={isCreating || quotaExhausted}
              >
                {isCreating ? (
                  <span className="h-4 w-4 inline-block animate-spin rounded-full border-2 border-muted-foreground/40 border-t-muted-foreground" />
                ) : (
                  <Plus className="h-5 w-5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">新建聊天</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10"
                aria-label="模型大乱斗"
                onClick={() => router.push('/main/battle')}
              >
                <Trophy className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">模型大乱斗</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10"
                aria-label="系统设置"
                onClick={() => setIsSettingsOpen(true)}
              >
                <Settings className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">系统设置</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* 底部：GitHub链接 */}
      <div className="flex flex-col items-center">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href={PROJECT_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[hsl(var(--sidebar-hover))] hover:text-primary"
                aria-label="项目地址"
              >
                <Github className="h-5 w-5" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">项目地址</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
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
            "relative h-full overflow-hidden bg-[hsl(var(--sidebar-bg))] transition-[width] duration-300 ease-in-out will-change-[width]",
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
          dialogTitle="侧边栏导航"
          className="w-72 border-r border-border/70 bg-[hsl(var(--sidebar-bg))] p-0 data-[state=closed]:duration-300 data-[state=open]:duration-300"
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
            className="h-12 w-12 rounded-full border border-border/80 bg-[hsl(var(--surface))/0.95] shadow-lg hover:bg-[hsl(var(--surface-hover))]"
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
