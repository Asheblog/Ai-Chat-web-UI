'use client'

import { useEffect, useState } from 'react'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { McpToolView, McpConnectionOption } from '@/hooks/use-mcp-session-bindings'

interface SkillOption {
  skillId: number
  versionId: number | null
  slug: string
  label: string
  description?: string
  enabled: boolean
  updating?: boolean
  sourceLabel?: string
  licenseName?: string | null
}

interface McpOption {
  connectionId: number
  connectionName: string
  installationLabel: string
  enabled: boolean
  bindingId?: number
  updating?: boolean
}

interface SkillPanelSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  webSearchEnabled?: boolean
  canUseWebSearch?: boolean
  showWebSearchScope?: boolean
  webSearchScope?: string
  onWebSearchScopeChange?: (value: string) => void
  webSearchDisabledNote?: string
  pythonToolEnabled?: boolean
  canUsePythonTool?: boolean
  pythonToolDisabledNote?: string
  skillOptions?: SkillOption[]
  onToggleSkillOption?: (skillId: number, enabled: boolean) => void
  // MCP props
  mcpGlobalEnabled?: boolean
  mcpConnectionOptions?: McpOption[]
  mcpSessionTools?: McpToolView[]
  mcpLoading?: boolean
  mcpError?: string | null
  onToggleMcpBinding?: (connectionId: number, enabled: boolean) => void
}

export function SkillPanelSheet({
  open,
  onOpenChange,
  webSearchEnabled = false,
  canUseWebSearch = true,
  showWebSearchScope = false,
  webSearchScope = 'webpage',
  onWebSearchScopeChange,
  webSearchDisabledNote,
  pythonToolEnabled = false,
  canUsePythonTool = true,
  pythonToolDisabledNote,
  skillOptions = [],
  onToggleSkillOption,
  mcpGlobalEnabled = true,
  mcpConnectionOptions = [],
  mcpSessionTools = [],
  mcpLoading = false,
  mcpError = null,
  onToggleMcpBinding,
}: SkillPanelSheetProps) {
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    if (typeof window.matchMedia !== 'function') return false
    return window.matchMedia('(min-width: 768px)').matches
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(min-width: 768px)')
    const update = () => setIsDesktop(mq.matches)
    update()
    const handle = (event: MediaQueryListEvent) => setIsDesktop(event.matches)
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', handle)
      return () => mq.removeEventListener('change', handle)
    }
    mq.addListener(handle)
    return () => mq.removeListener(handle)
  }, [])

  const shouldShowWebSearchScope = Boolean(showWebSearchScope && webSearchEnabled && canUseWebSearch)
  const enabledCount =
    (webSearchEnabled && canUseWebSearch ? 1 : 0) +
    (pythonToolEnabled && canUsePythonTool ? 1 : 0) +
    skillOptions.filter((item) => item.enabled).length +
    mcpConnectionOptions.filter((item) => item.enabled).length
  const hasBuiltinDetails = Boolean(
    (shouldShowWebSearchScope && onWebSearchScopeChange) ||
      webSearchDisabledNote ||
      pythonToolDisabledNote,
  )

  const mcpDisabled = !mcpGlobalEnabled
  const pinnedToolCount = mcpSessionTools.filter((t) => t.pinned).length

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isDesktop ? 'right' : 'bottom'}
        dialogTitle="技能面板"
        dialogDescription="管理当前会话可用的内置工具、MCP 连接和第三方 Skill。"
        className={cn(
          'p-0',
          isDesktop
            ? 'w-[420px] sm:w-[440px]'
            : 'h-[78vh] rounded-t-3xl border-x-0 border-b-0'
        )}
      >
        <div className="flex h-full flex-col">
          <div className="border-b border-border/70 px-5 py-4 pr-14">
            <p className="text-base font-semibold tracking-tight">技能面板</p>
            <p className="mt-1 text-xs text-muted-foreground">
              当前会话已启用 {enabledCount} 个技能/工具
            </p>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {hasBuiltinDetails ? (
              <section className="space-y-2 rounded-2xl border border-border/60 bg-muted/20 p-3">
                <p className="text-[11px] tracking-wide text-muted-foreground">内置工具细项</p>
                {shouldShowWebSearchScope && onWebSearchScopeChange ? (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">搜索范围（联网搜索）</p>
                    <Select
                      value={webSearchScope}
                      onValueChange={(value) => onWebSearchScopeChange(value)}
                      disabled={!canUseWebSearch}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="选择范围" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="webpage">网页</SelectItem>
                        <SelectItem value="document">文档</SelectItem>
                        <SelectItem value="paper">论文</SelectItem>
                        <SelectItem value="image">图片</SelectItem>
                        <SelectItem value="video">视频</SelectItem>
                        <SelectItem value="podcast">播客</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                {webSearchDisabledNote ? (
                  <p className="text-[11px] text-muted-foreground">{webSearchDisabledNote}</p>
                ) : null}
                {pythonToolDisabledNote ? (
                  <p className="text-[11px] text-muted-foreground">{pythonToolDisabledNote}</p>
                ) : null}
              </section>
            ) : null}

            {/* MCP 连接区域 */}
            {mcpDisabled ? (
              <section className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-3 opacity-50">
                <p className="text-[11px] tracking-wide text-muted-foreground">MCP 连接</p>
                <p className="text-xs text-muted-foreground mt-1">
                  管理员已关闭 MCP 全局开关，当前不可用。
                </p>
              </section>
            ) : mcpLoading ? (
              <section className="rounded-2xl border border-border/60 bg-muted/20 p-3">
                <p className="text-[11px] tracking-wide text-muted-foreground">MCP 连接</p>
                <div className="mt-2 space-y-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              </section>
            ) : mcpError ? (
              <section className="rounded-2xl border border-border/60 bg-muted/20 p-3">
                <p className="text-[11px] tracking-wide text-muted-foreground">MCP 连接</p>
                <p className="text-xs text-destructive mt-1">{mcpError}</p>
              </section>
            ) : mcpConnectionOptions.length > 0 ? (
              <section className="space-y-2 rounded-2xl border border-border/60 bg-muted/20 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] tracking-wide text-muted-foreground">MCP 连接</p>
                  {pinnedToolCount > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      {pinnedToolCount} 个工具可用
                    </span>
                  )}
                </div>
                {mcpConnectionOptions.map((conn) => (
                  <div key={conn.connectionId} className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{conn.connectionName}</p>
                      <p className="text-[10px] text-muted-foreground/80 truncate">
                        {conn.installationLabel}
                      </p>
                    </div>
                    <Switch
                      checked={conn.enabled}
                      disabled={conn.updating}
                      onCheckedChange={(checked) => onToggleMcpBinding?.(conn.connectionId, checked)}
                    />
                  </div>
                ))}
              </section>
            ) : (
              <section className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-3">
                <p className="text-[11px] tracking-wide text-muted-foreground">MCP 连接</p>
                <p className="text-xs text-muted-foreground mt-1">
                  暂无可用 MCP 连接。请在系统设置的工具与运行时中配置。
                </p>
              </section>
            )}

            {skillOptions.length > 0 ? (
              <section className="space-y-2 rounded-2xl border border-border/60 bg-muted/20 p-3">
                <p className="text-[11px] tracking-wide text-muted-foreground">第三方安装</p>
                {skillOptions.map((skill) => (
                  <div key={skill.skillId} className="space-y-1 border-b border-border/50 pb-2 last:border-b-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{skill.label}</p>
                        <p className="text-[10px] text-muted-foreground/80">
                          {skill.sourceLabel || 'github'} / {skill.slug}
                          {skill.licenseName ? ` · ${skill.licenseName}` : ''}
                        </p>
                      </div>
                      <Switch
                        checked={Boolean(skill.enabled)}
                        disabled={!skill.versionId || skill.updating}
                        onCheckedChange={(checked) => onToggleSkillOption?.(skill.skillId, Boolean(checked))}
                      />
                    </div>
                    {skill.description ? (
                      <p className="text-[11px] text-muted-foreground line-clamp-3">
                        {skill.description}
                      </p>
                    ) : null}
                  </div>
                ))}
              </section>
            ) : (
              <section className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">
                  当前会话暂无可启用的第三方 Skill。请登录后在个人设置的 Skill 商店安装。
                </p>
              </section>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export default SkillPanelSheet
