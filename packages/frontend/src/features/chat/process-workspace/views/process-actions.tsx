'use client'

import { Ban, Loader2, RefreshCw, Square } from 'lucide-react'
import type { ProcessCommandTarget, ProcessWorkspaceCommands } from '../types'
import { useStopToolsCommand } from '../hooks/use-stop-tools-command'

const buttonClass =
  'inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-caption font-medium text-foreground transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

/**
 * 工作区底部只放真实存在的整轮操作：
 * - 停止后续工具（流式中）：受理后等运行事件，不改工具状态
 * - 整轮取消：真正中止，不触发额外模型请求
 * - 整轮重新生成：不是单次工具重试，文案按整轮表达
 * 只读或没有回调时不渲染任何按钮。
 */
export function ProcessActions({
  canCommand,
  isStreaming,
  target,
  commands,
}: {
  canCommand: boolean
  isStreaming: boolean
  target: ProcessCommandTarget
  commands?: ProcessWorkspaceCommands
}) {
  const stop = useStopToolsCommand({
    enabled: canCommand && isStreaming && Boolean(commands?.onStopTools),
    target,
    onStopTools: commands?.onStopTools,
  })

  if (!canCommand || !commands) return null
  const canStop = isStreaming && Boolean(commands.onStopTools)
  const canCancel = isStreaming && Boolean(commands.onCancelRun)
  const canRegenerate = !isStreaming && Boolean(commands.onRegenerate)
  if (!canStop && !canCancel && !canRegenerate) return null

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {canStop && (
          <button
            type="button"
            className={buttonClass}
            onClick={stop.run}
            disabled={stop.phase === 'pending' || stop.phase === 'accepted'}
          >
            {stop.phase === 'pending' ? (
              <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
            ) : (
              <Square aria-hidden className="h-3.5 w-3.5" />
            )}
            {stop.phase === 'pending' ? '正在受理…' : stop.phase === 'accepted' ? '已受理' : '停止后续工具'}
          </button>
        )}
        {canCancel && (
          <button type="button" className={buttonClass} onClick={() => commands.onCancelRun?.(target)}>
            <Ban aria-hidden className="h-3.5 w-3.5" />
            取消本轮
          </button>
        )}
        {canRegenerate && (
          <button type="button" className={buttonClass} onClick={() => commands.onRegenerate?.(target)}>
            <RefreshCw aria-hidden className="h-3.5 w-3.5" />
            重新生成整轮
          </button>
        )}
      </div>
      {stop.phase === 'accepted' && (
        <p role="status" className="text-micro text-muted-foreground">
          已受理：停止后续工具后仍会用已有资料作答，结果以运行事件为准。
        </p>
      )}
      {stop.phase === 'error' && stop.error && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[hsl(var(--destructive)/0.3)] bg-[hsl(var(--destructive)/0.06)] px-2.5 py-1.5">
          <p role="alert" className="min-w-0 text-micro text-destructive [overflow-wrap:anywhere]">{stop.error}</p>
          <button type="button" className={buttonClass} onClick={stop.run}>重试停止请求</button>
        </div>
      )}
    </div>
  )
}
