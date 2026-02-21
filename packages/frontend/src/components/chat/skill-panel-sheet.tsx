'use client'

import { useEffect, useState } from 'react'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { getBuiltinSkillPreset } from '@/features/skills/presets'

interface SkillOption {
  slug: string
  label: string
  description?: string
  enabled: boolean
}

interface SkillPanelSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  webSearchEnabled?: boolean
  onToggleWebSearch?: (value: boolean) => void
  canUseWebSearch?: boolean
  showWebSearchScope?: boolean
  webSearchScope?: string
  onWebSearchScopeChange?: (value: string) => void
  webSearchDisabledNote?: string
  pythonToolEnabled?: boolean
  onTogglePythonTool?: (value: boolean) => void
  canUsePythonTool?: boolean
  pythonToolDisabledNote?: string
  skillOptions?: SkillOption[]
  onToggleSkillOption?: (slug: string, enabled: boolean) => void
}

export function SkillPanelSheet({
  open,
  onOpenChange,
  webSearchEnabled = false,
  onToggleWebSearch,
  canUseWebSearch = true,
  showWebSearchScope = false,
  webSearchScope = 'webpage',
  onWebSearchScopeChange,
  webSearchDisabledNote,
  pythonToolEnabled = false,
  onTogglePythonTool,
  canUsePythonTool = true,
  pythonToolDisabledNote,
  skillOptions = [],
  onToggleSkillOption,
}: SkillPanelSheetProps) {
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(min-width: 768px)').matches
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
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
    skillOptions.filter((item) => item.enabled).length
  const webSearchPreset = getBuiltinSkillPreset('web-search')
  const pythonPreset = getBuiltinSkillPreset('python-runner')

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isDesktop ? 'right' : 'bottom'}
        dialogTitle="技能面板"
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
              当前会话已启用 {enabledCount} 个技能
            </p>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            <section className="space-y-2 rounded-2xl border border-border/60 bg-muted/20 p-3">
              <p className="text-[11px] tracking-wide text-muted-foreground">内置预设</p>
              {onToggleWebSearch ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{webSearchPreset?.label || '联网搜索'}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {webSearchPreset?.description || '调用搜索引擎获取最新网页信息'}
                    </p>
                    <p className="text-[10px] text-muted-foreground/80">
                      slug: web-search / tool: {webSearchPreset?.toolName || 'web_search'}
                    </p>
                  </div>
                  <Switch
                    checked={Boolean(webSearchEnabled && canUseWebSearch)}
                    onCheckedChange={(checked) => onToggleWebSearch(Boolean(checked))}
                    disabled={!canUseWebSearch}
                  />
                </div>
              ) : null}
              {onTogglePythonTool ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{pythonPreset?.label || 'Python 工具'}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {pythonPreset?.description || '执行 Python 代码进行计算与数据处理'}
                    </p>
                    <p className="text-[10px] text-muted-foreground/80">
                      slug: python-runner / tool: {pythonPreset?.toolName || 'python_runner'}
                    </p>
                  </div>
                  <Switch
                    checked={Boolean(pythonToolEnabled && canUsePythonTool)}
                    onCheckedChange={(checked) => onTogglePythonTool(Boolean(checked))}
                    disabled={!canUsePythonTool}
                  />
                </div>
              ) : null}

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

            {skillOptions.length > 0 ? (
              <section className="space-y-2 rounded-2xl border border-border/60 bg-muted/20 p-3">
                <p className="text-[11px] tracking-wide text-muted-foreground">第三方安装</p>
                {skillOptions.map((skill) => (
                  <div key={skill.slug} className="space-y-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{skill.label}</p>
                        <p className="text-[10px] text-muted-foreground/80">slug: {skill.slug}</p>
                      </div>
                      <Switch
                        checked={Boolean(skill.enabled)}
                        onCheckedChange={(checked) => onToggleSkillOption?.(skill.slug, Boolean(checked))}
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
                  暂无第三方技能。可在系统设置的 Skill 管理页安装 GitHub Skill。
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
