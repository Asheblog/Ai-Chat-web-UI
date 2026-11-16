'use client'

import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDesktopComposer } from '@/hooks/use-desktop-composer'
import { Loader2, Send, Square } from 'lucide-react'
import type { ModelItem } from '@/store/models-store'
import { ModelSelector } from '@/components/model-selector'
import type { ModelReasoningControl, ModelSelectorView } from '@/components/model-selector/model-selector-types'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { composerToolbarSendSlotClass } from './composer-toolbar-primitives'
import { MOBILE_MODEL_SELECTOR_ID } from './composer-layout'

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
  modelPlacement?: 'inline' | 'mobile-header'
  modelDisabled?: boolean
  disabled: boolean
  isStreaming?: boolean
  isCreating?: boolean
  onSend: () => void
  onStop?: () => void
  stopLabel?: string
  sendTitle?: string
}

/** 手机模型入口挂载到主顶栏；发送/停止始终留在输入框操作栏。 */
export function ComposerModelActions({
  selectedModelId = null, onModelChange, reasoningControl, modelDisabled, disabled, isStreaming, isCreating,
  selectorOpen, onSelectorOpenChange, selectorView, formatModelName, modelPlacement = 'inline',
  onSend, onStop, stopLabel = '停止', sendTitle,
}: ComposerModelActionsProps) {
  const isDesktop = useDesktopComposer()
  const [headerTarget, setHeaderTarget] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    setHeaderTarget(modelPlacement === 'mobile-header' && !isDesktop
      ? document.getElementById(MOBILE_MODEL_SELECTOR_ID)
      : null)
  }, [modelPlacement, isDesktop])
  const modelSelector = onModelChange ? (
    <ModelSelector
      selectedModelId={selectedModelId} onModelChange={onModelChange}
      reasoningControl={reasoningControl}
      open={selectorOpen} onOpenChange={onSelectorOpenChange} defaultView={selectorView}
      formatTriggerName={formatModelName} disabled={modelDisabled} variant="inline"
      className={modelPlacement === 'mobile-header'
        ? 'h-11 min-h-11 w-auto min-w-0 max-w-full'
        : 'h-11 min-h-11 w-auto min-w-0 max-w-full md:h-auto md:min-h-9'}
    />
  ) : null
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
      className="ml-auto flex min-w-0 shrink items-center justify-end gap-2"
    >
      {modelPlacement === 'mobile-header'
        ? isDesktop ? null : headerTarget ? createPortal(modelSelector, headerTarget) : modelSelector
        : modelSelector}

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
