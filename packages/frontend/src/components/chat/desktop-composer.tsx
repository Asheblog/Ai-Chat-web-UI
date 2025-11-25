'use client'

import type { KeyboardEventHandler, MutableRefObject } from 'react'
import { motion } from 'framer-motion'
import { Plus, Maximize2, ImagePlus, Send, Square } from 'lucide-react'
import type { ChatComposerImage } from '@/hooks/use-chat-composer'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ChatImagePreview } from './chat-image-preview'
import { sendButtonVariants } from '@/lib/animations'
import { PlusMenuContent } from '@/components/plus-menu-content'

interface DesktopComposerProps {
  input: string
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>
  onInputChange: (value: string) => void
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>
  onCompositionStart: () => void
  onCompositionEnd: () => void
  placeholder: string
  textareaDisabled: boolean
  isStreaming: boolean
  selectedImages: ChatComposerImage[]
  onRemoveImage: (index: number) => void
  pickImages: () => void
  isVisionEnabled: boolean
  imageLimits: { maxCount: number; maxMb: number; maxEdge: number; maxTotalMb: number }
  thinkingEnabled: boolean
  onToggleThinking: (value: boolean) => void
  webSearchEnabled: boolean
  onToggleWebSearch: (value: boolean) => void
  webSearchScope: string
  onWebSearchScopeChange: (value: string) => void
  showWebSearchScope: boolean
  canUseWebSearch: boolean
  traceEnabled: boolean
  canUseTrace: boolean
  onToggleTrace: (value: boolean) => void
  effort: 'low' | 'medium' | 'high' | 'unset'
  onEffortChange: (value: 'low' | 'medium' | 'high' | 'unset') => void
  showExpand: boolean
  onExpandOpen: () => void
  onSend: () => void
  onStop: () => void
  desktopSendDisabled: boolean
  sendLockedReason: string | null
}

export function DesktopComposer({
  input,
  textareaRef,
  onInputChange,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  placeholder,
  textareaDisabled,
  isStreaming,
  selectedImages,
  onRemoveImage,
  pickImages,
  isVisionEnabled,
  imageLimits,
  thinkingEnabled,
  onToggleThinking,
  webSearchEnabled,
  onToggleWebSearch,
  webSearchScope,
  onWebSearchScopeChange,
  showWebSearchScope,
  canUseWebSearch,
  traceEnabled,
  canUseTrace,
  onToggleTrace,
  effort,
  onEffortChange,
  showExpand,
  onExpandOpen,
  onSend,
  onStop,
  desktopSendDisabled,
  sendLockedReason,
}: DesktopComposerProps) {
  const sendTooltip = isStreaming ? '停止生成' : sendLockedReason ?? '发送'

  return (
    <div className="hidden md:block">
      <div className="mx-auto max-w-3xl px-4 md:px-6 pb-6">
        <ChatImagePreview images={selectedImages} onRemove={onRemoveImage} />
        <div className="flex items-end gap-3 transition">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="h-12 w-12 inline-flex items-center justify-center rounded-full text-muted-foreground border border-transparent hover:border-border/70 hover:bg-muted/40"
                aria-label="更多操作"
              >
                <Plus className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <PlusMenuContent
              thinkingEnabled={thinkingEnabled}
              onToggleThinking={(checked) => onToggleThinking(Boolean(checked))}
              webSearchEnabled={webSearchEnabled}
              onToggleWebSearch={(checked) => onToggleWebSearch(Boolean(checked))}
              canUseWebSearch={canUseWebSearch}
              showWebSearchScope={showWebSearchScope}
              webSearchScope={webSearchScope}
              onWebSearchScopeChange={onWebSearchScopeChange}
              canUseTrace={canUseTrace}
              traceEnabled={traceEnabled}
              onToggleTrace={(checked) => onToggleTrace(Boolean(checked))}
              effort={effort}
              onEffortChange={(value) => onEffortChange(value as typeof effort)}
              contentClassName="rounded-2xl"
              bodyClassName="text-sm"
            />
          </DropdownMenu>

          <div className="flex-1">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={onKeyDown}
              onCompositionStart={onCompositionStart}
              onCompositionEnd={onCompositionEnd}
              placeholder={isStreaming ? 'AI正在思考中...' : placeholder}
              disabled={textareaDisabled}
              className="h-auto min-h-[48px] w-full resize-none rounded-3xl border border-border/60 bg-muted/60 px-4 sm:px-5 py-3 leading-[1.4] text-left placeholder:text-muted-foreground shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              rows={1}
            />
          </div>

          {showExpand && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="h-12 w-12 inline-flex items-center justify-center rounded-full border border-transparent hover:border-border/70 hover:bg-muted/40"
                    onClick={onExpandOpen}
                    aria-label="全屏编辑"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>全屏编辑</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="h-12 w-12 inline-flex items-center justify-center rounded-full border hover:bg-muted"
                  onClick={pickImages}
                  disabled={isStreaming || !isVisionEnabled}
                  aria-label="添加图片"
                >
                  <ImagePlus className="h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {isVisionEnabled
                  ? `添加图片（限制：最多 ${imageLimits.maxCount} 张，单张 ≤ ${imageLimits.maxMb}MB，总体积 ≤ ${imageLimits.maxTotalMb}MB，最大边长 ≤ ${imageLimits.maxEdge}px）`
                  : '当前模型不支持图片'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <motion.button
                  onClick={isStreaming ? onStop : onSend}
                  disabled={desktopSendDisabled}
                  aria-label={isStreaming ? '停止生成' : '发送'}
                  className={`h-12 w-12 inline-flex items-center justify-center rounded-full ${
                    isStreaming ? 'bg-destructive text-destructive-foreground hover:opacity-90' : 'bg-primary text-primary-foreground hover:opacity-90'
                  }`}
                  variants={sendButtonVariants}
                  animate={isStreaming ? 'sending' : 'idle'}
                  whileHover={!isStreaming ? 'hover' : undefined}
                  whileTap={!isStreaming ? 'tap' : undefined}
                >
                  {isStreaming ? <Square className="h-5 w-5" /> : <Send className="h-5 w-5" />}
                </motion.button>
              </TooltipTrigger>
              <TooltipContent>{sendTooltip}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  )
}
