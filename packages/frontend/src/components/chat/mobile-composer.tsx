'use client'

import type { ClipboardEventHandler, KeyboardEventHandler, MutableRefObject } from 'react'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Send, Square, Brain, Plus } from 'lucide-react'
import type { ChatComposerImage } from '@/hooks/use-chat-composer'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ChatImagePreview } from './chat-image-preview'
import { sendButtonVariants } from '@/lib/animations/chat'
import { PlusMenuContent } from '@/components/plus-menu-content'
import { AttachmentMenu } from '@/components/chat/attachment-menu'

interface MobileComposerProps {
  input: string
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>
  onInputChange: (value: string) => void
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>
  onPaste: ClipboardEventHandler<HTMLTextAreaElement>
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
  pickDocuments?: () => void
  hasDocuments?: boolean
  hasProcessingDocuments?: boolean
  onOpenAttachmentManager?: () => void
  attachmentsCount?: number
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
  // 知识库
  onOpenKnowledgeBase?: () => void
  knowledgeBaseEnabled?: boolean
  knowledgeBaseCount?: number
}

export function MobileComposer({
  input,
  textareaRef,
  onInputChange,
  onKeyDown,
  onPaste,
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
  pickDocuments,
  hasDocuments,
  hasProcessingDocuments,
  onOpenAttachmentManager,
  attachmentsCount = 0,
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
  // 知识库
  onOpenKnowledgeBase,
  knowledgeBaseEnabled,
  knowledgeBaseCount,
}: MobileComposerProps) {
  const disabled = sendLocked || hasProcessingDocuments || (!input.trim() && selectedImages.length === 0)
  const [plusOpen, setPlusOpen] = useState(false)

  return (
    <div className="md:hidden px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+18px)]">
      <div className="rounded-3xl border bg-card shadow-sm px-3 py-3 space-y-3">
        <ChatImagePreview images={selectedImages} onRemove={onRemoveImage} />
        <div className="flex flex-col gap-2">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <div className="overflow-hidden rounded-2xl">
                <Textarea
                  ref={textareaRef}
                  placeholder={placeholder}
                  value={input}
                  onChange={(e) => onInputChange(e.target.value)}
                  onKeyDown={onKeyDown}
                  onPaste={onPaste}
                  onCompositionStart={onCompositionStart}
                  onCompositionEnd={onCompositionEnd}
                  className="h-auto min-h-[40px] max-h-[200px] w-full resize-none border-0 bg-muted/40 px-4 py-2 text-sm leading-[1.45] transition-[height] duration-150 ease-out focus-visible:ring-0 focus-visible:ring-offset-0"
                  rows={1}
                  disabled={isStreaming}
                />
              </div>
            </div>

            <motion.div
              variants={sendButtonVariants}
              animate={isStreaming ? 'sending' : 'idle'}
              whileHover={!isStreaming ? 'hover' : undefined}
              whileTap={!isStreaming ? 'tap' : undefined}
            >
              <Button
                type="button"
                className={`h-12 w-12 shrink-0 rounded-full ${isStreaming ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground'
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
              className={`h-10 rounded-full px-2 pr-3 flex items-center gap-2 transition-colors ${thinkingEnabled
                  ? 'bg-primary/10 border-primary text-primary hover:bg-primary/20'
                  : 'bg-background border-border text-muted-foreground hover:bg-muted'
                }`}
              onClick={() => onToggleThinking(!thinkingEnabled)}
              aria-pressed={thinkingEnabled}
              aria-label={thinkingEnabled ? '关闭思考模式' : '开启思考模式'}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full ${thinkingEnabled ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground'
                  }`}
              >
                <Brain className="h-3.5 w-3.5" />
              </span>
              <span className="text-xs font-medium">思考</span>
            </Button>

            <DropdownMenu open={plusOpen} onOpenChange={setPlusOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className={`h-10 rounded-full px-3 pr-3 flex items-center gap-2 transition-colors ${plusOpen
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

            <div className="ml-auto">
              <AttachmentMenu
                onPickImages={pickImages}
                onPickDocuments={pickDocuments}
                disableImages={isStreaming || !isVisionEnabled}
                disableDocuments={isStreaming || !pickDocuments}
                hasImages={selectedImages.length > 0}
                hasDocuments={hasDocuments}
                onOpenManager={onOpenAttachmentManager}
                manageDisabled={!hasDocuments && selectedImages.length === 0}
                manageCount={attachmentsCount}
                ariaLabel="上传附件"
                className="h-10 w-10"
                onOpenKnowledgeBase={onOpenKnowledgeBase}
                knowledgeBaseEnabled={knowledgeBaseEnabled}
                knowledgeBaseCount={knowledgeBaseCount}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
