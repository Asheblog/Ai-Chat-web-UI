'use client'

import { DropdownMenuContent } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

interface PlusMenuContentProps {
  effort?: 'low' | 'medium' | 'high' | 'max' | 'xhigh' | 'unset'
  onEffortChange?: (value: 'low' | 'medium' | 'high' | 'max' | 'xhigh' | 'unset') => void
  traceEnabled?: boolean
  canUseTrace?: boolean
  onToggleTrace?: (value: boolean) => void
  contentClassName?: string
  bodyClassName?: string
  onOpenSkillPanel?: () => void
  onOpenAdvanced?: () => void
  onOpenSessionPrompt?: () => void
  showControlCard?: boolean
  showSkillPanelAction?: boolean
  showAdvancedRequestAction?: boolean
  showSessionPromptAction?: boolean
  extraAction?: {
    title: string
    description: string
    onClick?: () => void
    disabled?: boolean
  }
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
  effort = 'unset',
  onEffortChange,
  traceEnabled,
  canUseTrace = false,
  onToggleTrace,
  contentClassName,
  bodyClassName,
  onOpenSkillPanel,
  onOpenAdvanced,
  onOpenSessionPrompt,
  showControlCard = true,
  showSkillPanelAction = true,
  showAdvancedRequestAction = true,
  showSessionPromptAction = true,
  extraAction,
  container = 'dropdown',
  align = 'start',
  onActionComplete,
}: PlusMenuContentProps) {
  const handleAction = (action?: () => void) => {
    action?.()
    onActionComplete?.()
  }
  const hasSecondaryControls = Boolean(onEffortChange || (canUseTrace && onToggleTrace))

  const body = (
    <div className={cn('space-y-3', bodyClassName)}>
      {showControlCard && hasSecondaryControls ? (
        <div className="rounded-2xl border border-border/70 bg-[hsl(var(--surface))/0.72] p-3">
          <div className="space-y-3">
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
                    <SelectItem value="max">max</SelectItem>
                    <SelectItem value="xhigh">xhigh</SelectItem>
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
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        {showSkillPanelAction ? (
          <ActionCardButton
            title="第三方技能"
            description="管理第三方 Skill 与工具细项。"
            onClick={() => handleAction(onOpenSkillPanel)}
            disabled={!onOpenSkillPanel}
          />
        ) : null}

        {showAdvancedRequestAction && onOpenAdvanced ? (
          <ActionCardButton
            title="编辑自定义请求头"
            description="为当前请求附加高级参数。"
            onClick={() => handleAction(onOpenAdvanced)}
          />
        ) : null}

        {showSessionPromptAction && onOpenSessionPrompt ? (
          <ActionCardButton
            title="当前会话系统提示词"
            description="查看或修改会话级系统提示词。"
            onClick={() => handleAction(onOpenSessionPrompt)}
          />
        ) : null}

        {extraAction ? (
          <ActionCardButton
            title={extraAction.title}
            description={extraAction.description}
            onClick={() => handleAction(extraAction.onClick)}
            disabled={extraAction.disabled}
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
