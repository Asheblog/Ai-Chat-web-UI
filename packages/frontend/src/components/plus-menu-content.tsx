'use client'

import { DropdownMenuContent } from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

interface PlusMenuContentProps {
  /** @deprecated 强度入口已迁到模型选择器；仅为旧调用方保留签名，面板不再渲染。 */
  effort?: 'low' | 'medium' | 'high' | 'max' | 'xhigh' | 'unset'
  /** @deprecated 见 effort。 */
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
      className="w-full cursor-pointer rounded-xl border border-border bg-[hsl(var(--surface))/0.75] px-3 py-2.5 text-left transition-colors hover:bg-[hsl(var(--surface-hover))] disabled:cursor-not-allowed disabled:opacity-45"
      onClick={onClick}
      disabled={disabled}
    >
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </button>
  )
}

export function PlusMenuContent({
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
  const hasSecondaryControls = Boolean(canUseTrace && onToggleTrace)

  const body = (
    <div className={cn('space-y-3', bodyClassName)}>
      {showControlCard && hasSecondaryControls ? (
        <div className="rounded-lg border border-border bg-[hsl(var(--surface))/0.72] p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">任务追踪</span>
            <Switch
              aria-label="任务追踪"
              checked={Boolean(traceEnabled)}
              onCheckedChange={(checked) => onToggleTrace?.(Boolean(checked))}
            />
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
      className={cn('w-72 rounded-lg border-border p-2', contentClassName)}
    >
      {body}
    </DropdownMenuContent>
  )
}
