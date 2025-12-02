'use client'

import type { KeyboardEventHandler, MutableRefObject } from 'react'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Send, Square, ImagePlus, Brain, Globe, Plus, Pi } from 'lucide-react'
import type { ChatComposerImage } from '@/hooks/use-chat-composer'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ChatImagePreview } from './chat-image-preview'
import { sendButtonVariants } from '@/lib/animations'
import { PlusMenuContent } from '@/components/plus-menu-content'

interface MobileComposerProps {
  input: string
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>
  onInputChange: (value: string) => void
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>
  onCompositionStart: () => void
  onCompositionEnd: () => void
  isStreaming: boolean
  sendLocked: boolean
  sendLockedReason: string | null
  onSend: () => void
  onStop: () => void
  selectedImages: ChatComposerImage[]
  onRemoveImage: (index: number) => void
  thinkingEnabled: boolean
  onToggleThinking: (value: boolean) => void
  webSearchEnabled: boolean
  onToggleWebSearch: (value: boolean) => void
  webSearchScope: string
  onWebSearchScopeChange: (value: string) => void
  showWebSearchScope: boolean
  pickImages: () => void
  canUseWebSearch: boolean
  webSearchDisabledNote?: string
  pythonToolEnabled: boolean
  onTogglePythonTool: (value: boolean) => void
  canUsePythonTool: boolean
  pythonToolDisabledNote?: string
  isVisionEnabled: boolean
  placeholder: string
  traceEnabled: boolean
  canUseTrace: boolean
  onToggleTrace: (value: boolean) => void
  onOpenAdvanced: () => void
  onOpenSessionPrompt?: () => void
}

export function MobileComposer({
  input,
  textareaRef,
  onInputChange,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  isStreaming,
  sendLocked,
  sendLockedReason,
  onSend,
  onStop,
  selectedImages,
  onRemoveImage,
  thinkingEnabled,
  onToggleThinking,
  webSearchEnabled,
  onToggleWebSearch,
  webSearchScope,
  onWebSearchScopeChange,
  showWebSearchScope,
  pickImages,
  canUseWebSearch,
  webSearchDisabledNote,
  pythonToolEnabled,
  onTogglePythonTool,
  canUsePythonTool,
  pythonToolDisabledNote,
  isVisionEnabled,
  placeholder,
  traceEnabled,
  canUseTrace,
  onToggleTrace,
  onOpenAdvanced,
  onOpenSessionPrompt,
}: MobileComposerProps) {
  const disabled = sendLocked || (!input.trim() && selectedImages.length === 0)
  const [plusOpen, setPlusOpen] = useState(false)

  return (
    <div className="md:hidden px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+18px)]">
      <div className="rounded-3xl border bg-card shadow-sm px-3 py-3 space-y-3">
        <ChatImagePreview images={selectedImages} onRemove={onRemoveImage} />
        <div className="flex flex-col gap-2">
          <div className="flex items-end gap-2">
            <div className="flex-1 overflow-hidden">
              <Textarea
                ref={textareaRef}
                placeholder={placeholder}
                value={input}
                onChange={(e) => onInputChange(e.target.value)}
                onKeyDown={onKeyDown}
                onCompositionStart={onCompositionStart}
                onCompositionEnd={onCompositionEnd}
                className="h-auto min-h-[40px] w-full resize-none rounded-2xl border-0 bg-muted/40 px-4 py-2 text-sm leading-[1.45] focus-visible:ring-0 focus-visible:ring-offset-0"
                rows={1}
                disabled={isStreaming}
              />
            </div>

            <motion.div
              variants={sendButtonVariants}
              animate={isStreaming ? 'sending' : 'idle'}
              whileHover={!isStreaming ? 'hover' : undefined}
              whileTap={!isStreaming ? 'tap' : undefined}
            >
              <Button
                type="button"
                className={`h-12 w-12 shrink-0 rounded-full ${
                  isStreaming ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground'
                }`}
                onClick={() => {
                  if (isStreaming) {
                    onStop()
                  } else {
                    onSend()
                  }
                }}
                disabled={isStreaming ? false : disabled}
                title={!isStreaming && sendLocked && sendLockedReason ? sendLockedReason : undefined}
                aria-label={isStreaming ? '停止' : '发送'}
              >
                {isStreaming ? <Square className="h-5 w-5" /> : <Send className="h-5 w-5" />}
              </Button>
            </motion.div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className={`h-10 rounded-full px-2 pr-3 flex items-center gap-2 transition-colors ${
                thinkingEnabled
                  ? 'bg-primary/10 border-primary text-primary hover:bg-primary/20'
                  : 'bg-background border-border text-muted-foreground hover:bg-muted'
              }`}
              onClick={() => onToggleThinking(!thinkingEnabled)}
              aria-pressed={thinkingEnabled}
              aria-label={thinkingEnabled ? '关闭思考模式' : '开启思考模式'}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full ${
                  thinkingEnabled ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground'
                }`}
              >
                <Brain className="h-3.5 w-3.5" />
              </span>
              <span className="text-xs font-medium">思考</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              className={`h-10 rounded-full px-2 pr-3 flex items-center gap-2 transition-colors ${
                webSearchEnabled
                  ? 'bg-sky-100 border-sky-200 text-sky-700 dark:bg-sky-900/40 dark:border-sky-800 dark:text-sky-200'
                  : 'bg-background border-border text-muted-foreground hover:bg-muted'
              }`}
              onClick={() => onToggleWebSearch(!webSearchEnabled)}
              aria-pressed={webSearchEnabled}
              disabled={!canUseWebSearch || isStreaming}
              aria-label="联网搜索"
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full ${
                  webSearchEnabled ? 'bg-sky-600 text-white shadow-sm' : 'bg-muted text-muted-foreground'
                }`}
              >
                <Globe className="h-3.5 w-3.5" />
              </span>
              <span className="text-xs font-medium">联网</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              className={`h-10 rounded-full px-2 pr-3 flex items-center gap-2 transition-colors ${
                pythonToolEnabled
                  ? 'bg-emerald-100 border-emerald-200 text-emerald-700 dark:bg-emerald-900/40 dark:border-emerald-800 dark:text-emerald-200'
                  : 'bg-background border-border text-muted-foreground hover:bg-muted'
              }`}
              onClick={() => onTogglePythonTool(!pythonToolEnabled)}
              aria-pressed={pythonToolEnabled}
              disabled={!canUsePythonTool || isStreaming}
              aria-label="Python 工具"
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full ${
                  pythonToolEnabled ? 'bg-emerald-600 text-white shadow-sm' : 'bg-muted text-muted-foreground'
                }`}
              >
                <Pi className="h-3.5 w-3.5" />
              </span>
              <span className="text-xs font-medium">Python</span>
            </Button>

            <DropdownMenu open={plusOpen} onOpenChange={setPlusOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className={`h-10 rounded-full px-3 pr-3 flex items-center gap-2 transition-colors ${
                    plusOpen
                      ? 'bg-muted border-border text-foreground'
                      : 'bg-background border-border text-muted-foreground hover:bg-muted'
                  }`}
                  aria-label="更多操作"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Plus className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-xs font-medium">更多</span>
                </Button>
              </DropdownMenuTrigger>
                <PlusMenuContent
                  thinkingEnabled={thinkingEnabled}
                  onToggleThinking={(checked) => onToggleThinking(Boolean(checked))}
                  webSearchEnabled={webSearchEnabled}
                  onToggleWebSearch={(checked) => onToggleWebSearch(Boolean(checked))}
                  canUseWebSearch={canUseWebSearch}
                  showWebSearchScope={showWebSearchScope}
                  webSearchScope={webSearchScope}
                  onWebSearchScopeChange={(value) => {
                    onWebSearchScopeChange(value)
                    setPlusOpen(false)
                  }}
                  webSearchDisabledNote={webSearchDisabledNote}
                  pythonToolEnabled={pythonToolEnabled}
                  onTogglePythonTool={(checked) => onTogglePythonTool(Boolean(checked))}
                  canUsePythonTool={canUsePythonTool}
                  pythonToolDisabledNote={pythonToolDisabledNote}
                  canUseTrace={canUseTrace}
                  traceEnabled={traceEnabled}
                onToggleTrace={(checked) => {
                  onToggleTrace(Boolean(checked))
                  setPlusOpen(false)
                }}
                showThinkingToggle={false}
                showWebSearchToggle={false}
                onOpenAdvanced={() => {
                  setPlusOpen(false)
                  onOpenAdvanced()
                }}
                onOpenSessionPrompt={
                  onOpenSessionPrompt
                    ? () => {
                        setPlusOpen(false)
                        onOpenSessionPrompt()
                      }
                    : undefined
                }
              />
            </DropdownMenu>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 rounded-full ml-auto"
                    onClick={pickImages}
                    disabled={isStreaming || !isVisionEnabled}
                    aria-label="上传图片"
                  >
                    <ImagePlus className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>上传图片</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </div>
    </div>
  )
}
