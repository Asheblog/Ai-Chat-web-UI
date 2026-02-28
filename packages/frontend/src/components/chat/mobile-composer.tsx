'use client'

import type { ClipboardEventHandler, KeyboardEventHandler, MutableRefObject } from 'react'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Send, Square, Brain, Plus } from 'lucide-react'
import type { ChatComposerImage } from '@/hooks/use-chat-composer'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { ChatImagePreview } from './chat-image-preview'
import { sendButtonVariants } from '@/lib/animations/chat'
import { PlusMenuContent } from '@/components/plus-menu-content'
import { AttachmentMenu } from '@/components/chat/attachment-menu'
import type { ComposerSkillOption } from './chat-composer-panel'
import { SkillPanelSheet } from './skill-panel-sheet'

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
  skillOptions: ComposerSkillOption[]
  onToggleSkillOption: (slug: string, enabled: boolean) => void
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
  skillOptions,
  onToggleSkillOption,
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
  const [skillPanelOpen, setSkillPanelOpen] = useState(false)
  const openSkillPanelFromMenu = () => {
    setPlusOpen(false)
    window.setTimeout(() => {
      setSkillPanelOpen(true)
    }, 0)
  }

  return (
    <div className="md:hidden px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+18px)]">
      <div className="space-y-3 rounded-[1.75rem] border border-border/70 bg-[hsl(var(--surface))/0.9] px-3 py-3 shadow-[0_16px_40px_hsl(var(--background)/0.24)] backdrop-blur-md">
        <ChatImagePreview images={selectedImages} onRemove={onRemoveImage} className="mb-0" />

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className={`h-10 rounded-full px-2 pr-3 transition-colors ${
              thinkingEnabled
                ? 'border-primary/50 bg-primary/10 text-primary hover:bg-primary/20'
                : 'border-border/70 bg-[hsl(var(--surface))/0.75] text-muted-foreground hover:bg-[hsl(var(--surface-hover))]'
            }`}
            onClick={() => onToggleThinking(!thinkingEnabled)}
            aria-pressed={thinkingEnabled}
            aria-label={thinkingEnabled ? '关闭思考模式' : '开启思考模式'}
          >
            <span
              className={`mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full ${
                thinkingEnabled ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              }`}
            >
              <Brain className="h-3.5 w-3.5" />
            </span>
            <span className="text-xs font-medium">思考</span>
          </Button>

          <Sheet open={plusOpen} onOpenChange={setPlusOpen}>
            <SheetTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className={`h-10 rounded-full px-3 text-xs font-medium transition-colors ${
                  plusOpen
                    ? 'border-primary/45 bg-primary/10 text-primary'
                    : 'border-border/70 bg-[hsl(var(--surface))/0.75] text-muted-foreground hover:bg-[hsl(var(--surface-hover))]'
                }`}
                aria-label="更多操作"
              >
                <Plus className="mr-1.5 h-4 w-4" />
                更多
              </Button>
            </SheetTrigger>
            <SheetContent
              side="bottom"
              dialogTitle="更多操作"
              className="rounded-t-3xl border-border/80 bg-card/95 pb-[calc(env(safe-area-inset-bottom)+20px)]"
            >
              <div className="px-4 pt-4 pb-2">
                <h3 className="text-base font-semibold text-foreground">更多操作</h3>
                <p className="mt-1 text-xs text-muted-foreground">在这里配置技能、请求头与会话提示词。</p>
              </div>
              <div className="max-h-[70vh] overflow-y-auto px-4 pb-2">
                <PlusMenuContent
                  thinkingEnabled={thinkingEnabled}
                  onToggleThinking={(checked) => onToggleThinking(Boolean(checked))}
                  webSearchEnabled={webSearchEnabled}
                  onToggleWebSearch={(checked) => onToggleWebSearch(Boolean(checked))}
                  canUseWebSearch={canUseWebSearch}
                  showWebSearchScope={showWebSearchScope}
                  webSearchScope={webSearchScope}
                  onWebSearchScopeChange={onWebSearchScopeChange}
                  webSearchDisabledNote={webSearchDisabledNote}
                  pythonToolEnabled={pythonToolEnabled}
                  onTogglePythonTool={(checked) => onTogglePythonTool(Boolean(checked))}
                  canUsePythonTool={canUsePythonTool}
                  pythonToolDisabledNote={pythonToolDisabledNote}
                  skillOptions={skillOptions}
                  onToggleSkillOption={onToggleSkillOption}
                  onOpenSkillPanel={openSkillPanelFromMenu}
                  canUseTrace={canUseTrace}
                  traceEnabled={traceEnabled}
                  onToggleTrace={(checked) => onToggleTrace(Boolean(checked))}
                  showThinkingToggle={false}
                  showWebSearchToggle={false}
                  onOpenAdvanced={onOpenAdvanced}
                  onOpenSessionPrompt={onOpenSessionPrompt}
                  container="plain"
                  onActionComplete={() => setPlusOpen(false)}
                />
              </div>
            </SheetContent>
          </Sheet>

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
              className="h-10 w-10 rounded-full"
              menuMode="sheet"
              onOpenKnowledgeBase={onOpenKnowledgeBase}
              knowledgeBaseEnabled={knowledgeBaseEnabled}
              knowledgeBaseCount={knowledgeBaseCount}
            />
          </div>
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1 overflow-hidden rounded-2xl border border-border/70 bg-[hsl(var(--surface))/0.82] focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-ring/40">
            <Textarea
              ref={textareaRef}
              placeholder={placeholder}
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onCompositionStart={onCompositionStart}
              onCompositionEnd={onCompositionEnd}
              className="h-auto min-h-[44px] max-h-[200px] w-full resize-none border-0 bg-transparent px-4 py-2.5 text-sm leading-[1.45] transition-[height] duration-150 ease-out focus-visible:ring-0 focus-visible:ring-offset-0"
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
              className={`h-12 w-12 shrink-0 rounded-2xl shadow-[0_10px_24px_hsl(var(--background)/0.24)] ${
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
      </div>

      <SkillPanelSheet
        open={skillPanelOpen}
        onOpenChange={setSkillPanelOpen}
        webSearchEnabled={webSearchEnabled}
        onToggleWebSearch={(checked) => onToggleWebSearch(Boolean(checked))}
        canUseWebSearch={canUseWebSearch}
        showWebSearchScope={showWebSearchScope}
        webSearchScope={webSearchScope}
        onWebSearchScopeChange={onWebSearchScopeChange}
        webSearchDisabledNote={webSearchDisabledNote}
        pythonToolEnabled={pythonToolEnabled}
        onTogglePythonTool={(checked) => onTogglePythonTool(Boolean(checked))}
        canUsePythonTool={canUsePythonTool}
        pythonToolDisabledNote={pythonToolDisabledNote}
        skillOptions={skillOptions}
        onToggleSkillOption={onToggleSkillOption}
      />
    </div>
  )
}
