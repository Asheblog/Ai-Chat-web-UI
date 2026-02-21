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
}: PlusMenuContentProps) {
  const enabledSkillCount =
    (webSearchEnabled && canUseWebSearch ? 1 : 0) +
    (pythonToolEnabled && canUsePythonTool ? 1 : 0) +
    skillOptions.filter((item) => item.enabled).length

  return (
    <DropdownMenuContent align="start" className={cn('w-64', contentClassName)}>
      <div className={cn('px-3 py-3 space-y-3', bodyClassName)}>
        {/* 思考模式 */}
        {showThinkingToggle ? (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">思考模式</span>
            <Switch checked={thinkingEnabled} onCheckedChange={(checked) => onToggleThinking(Boolean(checked))} />
          </div>
        ) : null}

        {/* 思考深度 */}
        {onEffortChange ? (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">思考深度</span>
            <Select value={effort} onValueChange={(value) => onEffortChange(value as typeof effort)}>
              <SelectTrigger className="h-8 w-32">
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

        <button
          type="button"
          className="w-full rounded-xl border border-dashed border-border/70 bg-muted/30 px-3 py-2 text-left hover:bg-muted text-sm font-medium"
          onClick={() => {
            onOpenSkillPanel?.()
          }}
          disabled={!onOpenSkillPanel}
        >
          打开技能面板
        </button>
        <p className="text-[11px] text-muted-foreground">
          当前已启用 {enabledSkillCount} 个技能（内置预设 + 第三方安装）
        </p>

        {/* 任务追踪 */}
        {canUseTrace && onToggleTrace ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">任务追踪</span>
              <Switch checked={Boolean(traceEnabled)} onCheckedChange={(checked) => onToggleTrace(Boolean(checked))} />
            </div>
            <p className="text-[11px] text-muted-foreground">仅管理员可见，用于临时关闭某次追踪。</p>
          </div>
        ) : null}

        {/* 编辑自定义请求头 */}
        {onOpenAdvanced ? (
          <button
            type="button"
            className="w-full rounded-xl border border-dashed border-border/70 bg-muted/30 px-3 py-2 text-left hover:bg-muted text-sm font-medium"
            onClick={onOpenAdvanced}
          >
            编辑自定义请求头
          </button>
        ) : null}

        {/* 当前会话系统提示词 */}
        {onOpenSessionPrompt ? (
          <button
            type="button"
            className="w-full rounded-xl border border-dashed border-border/70 bg-muted/30 px-3 py-2 text-left hover:bg-muted text-sm font-medium"
            onClick={onOpenSessionPrompt}
          >
            当前会话系统提示词
          </button>
        ) : null}
      </div>
    </DropdownMenuContent>
  )
}
