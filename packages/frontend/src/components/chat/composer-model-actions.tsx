'use client'

import { Loader2, Send, Square } from 'lucide-react'
import type { ModelItem } from '@/store/models-store'
import { ModelSelector } from '@/components/model-selector'
import type { ModelReasoningControl, ModelSelectorView } from '@/components/model-selector/model-selector-types'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { composerToolbarSendSlotClass } from './composer-toolbar-primitives'

export interface ComposerModelControlProps {
  selectedModelId?: string | null
  onModelChange?: (model: ModelItem) => void
  /** 上层提供的思考强度；不传时入口保持纯模型选择。 */
  reasoningControl?: ModelReasoningControl
  /** 可选受控展开：供“思考”标签直达强度视图，其他调用方无需提供。 */
  selectorOpen?: boolean
  onSelectorOpenChange?: (open: boolean) => void
  /** 每次展开时进入的视图；默认模型列表。 */
  selectorView?: ModelSelectorView
  /** 只影响触发器可见文本的短名规则（手机使用）；完整名称仍在 title 与可访问描述中。 */
  formatModelName?: (name: string) => string
}

interface ComposerModelActionsProps extends ComposerModelControlProps {
  modelDisabled?: boolean
  disabled: boolean
  isStreaming?: boolean
  isCreating?: boolean
  onSend: () => void
  onStop?: () => void
  stopLabel?: string
  sendTitle?: string
}

/** The model may truncate; send/stop always owns its full touch target. */
export function ComposerModelActions({
  selectedModelId = null, onModelChange, reasoningControl, modelDisabled, disabled, isStreaming, isCreating,
  selectorOpen, onSelectorOpenChange, selectorView, formatModelName,
  onSend, onStop, stopLabel = '停止', sendTitle,
}: ComposerModelActionsProps) {
  const label = isStreaming ? stopLabel : isCreating ? '正在创建会话' : '发送'
  const sendButton = (
    <Button
      type="button"
      onClick={isStreaming ? onStop : onSend}
      disabled={isStreaming ? false : disabled}
      aria-label={label}
      title={sendTitle}
      className={
        'h-11 w-11 shrink-0 rounded-[10px] p-0 shadow-none md:h-9 md:w-9 ' +
        (isStreaming
          ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
          : 'bg-foreground text-background hover:bg-foreground/90')
      }
    >
      {isStreaming ? <Square className="h-[18px] w-[18px]" /> : isCreating ? (
        <Loader2 className="h-[18px] w-[18px] animate-spin" />
      ) : <Send className="h-[18px] w-[18px]" />}
    </Button>
  )

  return (
    <div
      data-composer-model-actions="true"
      className="flex min-w-0 flex-1 items-center justify-end gap-2 md:w-auto md:max-w-[17rem] md:flex-initial md:shrink-0"
    >
      {onModelChange && (
        <div className="min-w-0 max-w-[218px] flex-1 md:w-[180px] md:flex-initial">
          <ModelSelector
            selectedModelId={selectedModelId}
            onModelChange={onModelChange}
            reasoningControl={reasoningControl}
            open={selectorOpen}
            onOpenChange={onSelectorOpenChange}
            defaultView={selectorView}
            formatTriggerName={formatModelName}
            disabled={modelDisabled}
            variant="inline"
            className="h-11 min-h-11 w-full min-w-0 max-w-full md:h-9 md:min-h-9"
          />
        </div>
      )}
      <div className={composerToolbarSendSlotClass}>
        {sendTitle ? (
          <TooltipProvider><Tooltip><TooltipTrigger asChild>{sendButton}</TooltipTrigger>
            <TooltipContent>{sendTitle}</TooltipContent>
          </Tooltip></TooltipProvider>
        ) : sendButton}
      </div>
    </div>
  )
}