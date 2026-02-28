'use client'

import { DropdownMenuContent } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

interface PlusMenuContentProps {
  thinkingEnabled: boolean
  onToggleThinking: (value: boolean) => void
  effort?: 'low' | 'medium' | 'high' | 'unset'
  onEffortChange?: (value: 'low' | 'medium' | 'high' | 'unset') => void
  webSearchEnabled?: boolean
  onToggleWebSearch?: (value: boolean) => void
  canUseWebSearch?: boolean
  showWebSearchScope?: boolean
  webSearchScope?: string
  onWebSearchScopeChange?: (value: string) => void
  traceEnabled?: boolean
  canUseTrace?: boolean
  onToggleTrace?: (value: boolean) => void
  webSearchDisabledNote?: string
  pythonToolEnabled?: boolean
  onTogglePythonTool?: (value: boolean) => void
  canUsePythonTool?: boolean
  pythonToolDisabledNote?: string
  skillOptions?: Array<{
    slug: string
    label: string
    description?: string
    enabled: boolean
  }>
  onToggleSkillOption?: (slug: string, enabled: boolean) => void
  contentClassName?: string
  bodyClassName?: string
  onOpenSkillPanel?: () => void
  onOpenAdvanced?: () => void
  onOpenSessionPrompt?: () => void
  showThinkingToggle?: boolean
  showWebSearchToggle?: boolean
  container?: 'dropdown' | 'plain'
  align?: 'start' | 'center' | 'end'
  onActionComplete?: () => void
}

function ActionCardButton({
  title,
  description,
  onClick,
  disabled,
}: {
  title: string
  description: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className="w-full cursor-pointer rounded-xl border border-border/70 bg-[hsl(var(--surface))/0.75] px-3 py-2.5 text-left transition-colors hover:bg-[hsl(var(--surface-hover))] disabled:cursor-not-allowed disabled:opacity-45"
      onClick={onClick}
      disabled={disabled}
    >
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </button>
  )
}

export function PlusMenuContent({
  thinkingEnabled,
  onToggleThinking,
  effort = 'unset',
  onEffortChange,
  webSearchEnabled = false,
  canUseWebSearch = true,
  traceEnabled,
  canUseTrace = false,
  onToggleTrace,
  pythonToolEnabled,
  canUsePythonTool = true,
  skillOptions = [],
  contentClassName,
  bodyClassName,
  onOpenSkillPanel,
  onOpenAdvanced,
  onOpenSessionPrompt,
  showThinkingToggle = true,
  container = 'dropdown',
  align = 'start',
  onActionComplete,
}: PlusMenuContentProps) {
  const enabledSkillCount =
    (webSearchEnabled && canUseWebSearch ? 1 : 0) +
    (pythonToolEnabled && canUsePythonTool ? 1 : 0) +
    skillOptions.filter((item) => item.enabled).length

  const handleAction = (action?: () => void) => {
    action?.()
    onActionComplete?.()
  }

  const body = (
    <div className={cn('space-y-3', bodyClassName)}>
      <div className="rounded-2xl border border-border/70 bg-[hsl(var(--surface))/0.72] p-3">
        <div className="space-y-3">
          {showThinkingToggle ? (
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">思考模式</span>
              <Switch checked={thinkingEnabled} onCheckedChange={(checked) => onToggleThinking(Boolean(checked))} />
            </div>
          ) : null}

          {onEffortChange ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-muted-foreground">思考深度</span>
              <Select value={effort} onValueChange={(value) => onEffortChange(value as typeof effort)}>
                <SelectTrigger className="h-8 w-32 rounded-lg border-border/70 bg-background/60 text-xs">
                  <SelectValue placeholder="不设置" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">不设置</SelectItem>
                  <SelectItem value="low">low</SelectItem>
                  <SelectItem value="medium">medium</SelectItem>
                  <SelectItem value="high">high</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {canUseTrace && onToggleTrace ? (
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">任务追踪</span>
              <Switch checked={Boolean(traceEnabled)} onCheckedChange={(checked) => onToggleTrace(Boolean(checked))} />
            </div>
          ) : null}

          <p className="text-[11px] leading-5 text-muted-foreground">
            已启用 {enabledSkillCount} 个能力（内置 + 第三方技能）。
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <ActionCardButton
          title="打开技能面板"
          description="管理联网检索、Python 工具与第三方技能。"
          onClick={() => handleAction(onOpenSkillPanel)}
          disabled={!onOpenSkillPanel}
        />

        {onOpenAdvanced ? (
          <ActionCardButton
            title="编辑自定义请求头"
            description="为当前请求附加高级参数。"
            onClick={() => handleAction(onOpenAdvanced)}
          />
        ) : null}

        {onOpenSessionPrompt ? (
          <ActionCardButton
            title="当前会话系统提示词"
            description="查看或修改会话级系统提示词。"
            onClick={() => handleAction(onOpenSessionPrompt)}
          />
        ) : null}
      </div>
    </div>
  )

  if (container === 'plain') {
    return <div className={cn('w-full', contentClassName)}>{body}</div>
  }

  return (
    <DropdownMenuContent
      align={align}
      sideOffset={8}
      className={cn('w-72 rounded-2xl border-border/80 p-2', contentClassName)}
    >
      {body}
    </DropdownMenuContent>
  )
}
