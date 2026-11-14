'use client'

import { Loader2, Send, Square } from 'lucide-react'
import type { ModelItem } from '@/store/models-store'
import { ModelSelector } from '@/components/model-selector'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { composerToolbarSendSlotClass } from './composer-toolbar-primitives'

export interface ComposerModelControlProps {
  selectedModelId?: string | null
  onModelChange?: (model: ModelItem) => void
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
  selectedModelId = null, onModelChange, modelDisabled, disabled, isStreaming, isCreating,
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
    <div className="flex w-full min-w-0 items-center justify-end gap-2 md:w-auto md:max-w-[17rem] md:shrink-0">
      {onModelChange && (
        <div className="min-w-0 max-w-[218px] flex-1 md:w-[180px] md:flex-initial">
          <ModelSelector
            selectedModelId={selectedModelId}
            onModelChange={onModelChange}
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
