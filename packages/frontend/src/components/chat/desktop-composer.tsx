'use client'

import type { ClipboardEventHandler, KeyboardEventHandler, MutableRefObject } from 'react'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Maximize2, Send, Square } from 'lucide-react'
import type { ChatComposerImage } from '@/hooks/use-chat-composer'
import { Textarea } from '@/components/ui/textarea'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ChatImagePreview } from './chat-image-preview'
import { sendButtonVariants } from '@/lib/animations/chat'
import { PlusMenuContent } from '@/components/plus-menu-content'
import { AttachmentMenu } from '@/components/chat/attachment-menu'
import type { ComposerSkillOption } from './chat-composer-panel'
import { SkillPanelSheet } from './skill-panel-sheet'

interface DesktopComposerProps {
  input: string
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>
  onInputChange: (value: string) => void
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>
  onPaste: ClipboardEventHandler<HTMLTextAreaElement>
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
  webSearchDisabledNote?: string
  pythonToolEnabled: boolean
  onTogglePythonTool: (value: boolean) => void
  canUsePythonTool: boolean
  pythonToolDisabledNote?: string
  skillOptions: ComposerSkillOption[]
  onToggleSkillOption: (slug: string, enabled: boolean) => void
  traceEnabled: boolean
  canUseTrace: boolean
  onToggleTrace: (value: boolean) => void
  effort: 'low' | 'medium' | 'high' | 'unset'
  onEffortChange: (value: 'low' | 'medium' | 'high' | 'unset') => void
  showExpand: boolean
  onExpandOpen: () => void
  onOpenAdvanced: () => void
  onOpenSessionPrompt: () => void
  onSend: () => void
  onStop: () => void
  desktopSendDisabled: boolean
  sendLockedReason: string | null
  // 文档附件
  hasDocuments?: boolean
  pickDocuments?: () => void
  onOpenAttachmentManager?: () => void
  attachedDocumentsLength?: number
  // 知识库
  onOpenKnowledgeBase?: () => void
  knowledgeBaseEnabled?: boolean
  knowledgeBaseCount?: number
}

export function DesktopComposer({
  input,
  textareaRef,
  onInputChange,
  onKeyDown,
  onPaste,
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
  webSearchDisabledNote,
  pythonToolEnabled,
  onTogglePythonTool,
  canUsePythonTool,
  pythonToolDisabledNote,
  skillOptions,
  onToggleSkillOption,
  traceEnabled,
  canUseTrace,
  onToggleTrace,
  effort,
  onEffortChange,
  showExpand,
  onExpandOpen,
  onOpenAdvanced,
  onOpenSessionPrompt,
  onSend,
  onStop,
  desktopSendDisabled,
  sendLockedReason,
  hasDocuments,
  pickDocuments,
  onOpenAttachmentManager,
  attachedDocumentsLength = 0,
  // 知识库
  onOpenKnowledgeBase,
  knowledgeBaseEnabled,
  knowledgeBaseCount,
}: DesktopComposerProps) {
  const sendTooltip = isStreaming ? '停止生成' : sendLockedReason ?? '发送'
  const [plusOpen, setPlusOpen] = useState(false)
  const [skillPanelOpen, setSkillPanelOpen] = useState(false)
  const openSkillPanelFromMenu = () => {
    setPlusOpen(false)
    window.setTimeout(() => {
      setSkillPanelOpen(true)
    }, 0)
  }

  return (
    <div className="hidden md:block">
      <div className="mx-auto max-w-4xl px-4 md:px-6 pb-6">
        <ChatImagePreview images={selectedImages} onRemove={onRemoveImage} className="mb-3" />
        <div className="flex items-end gap-2">
          <div className="flex h-14 items-center gap-1 rounded-2xl border border-border/70 bg-[hsl(var(--surface))/0.78] px-2 shadow-[0_10px_24px_hsl(var(--background)/0.16)] backdrop-blur-sm">
            <DropdownMenu open={plusOpen} onOpenChange={setPlusOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-[hsl(var(--surface-hover))] hover:text-foreground"
                  aria-label="更多操作"
                >
                  <Plus className="h-[18px] w-[18px]" />
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
                webSearchDisabledNote={webSearchDisabledNote}
                pythonToolEnabled={pythonToolEnabled}
                onTogglePythonTool={(checked) => onTogglePythonTool(Boolean(checked))}
                canUsePythonTool={canUsePythonTool}
                pythonToolDisabledNote={pythonToolDisabledNote}
                skillOptions={skillOptions}
                onToggleSkillOption={onToggleSkillOption}
                canUseTrace={canUseTrace}
                traceEnabled={traceEnabled}
                onToggleTrace={(checked) => onToggleTrace(Boolean(checked))}
                effort={effort}
                onEffortChange={(value) => onEffortChange(value as typeof effort)}
                contentClassName="rounded-2xl"
                bodyClassName="text-sm"
                onOpenSkillPanel={openSkillPanelFromMenu}
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

            {showExpand && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-[hsl(var(--surface-hover))] hover:text-foreground"
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

            <AttachmentMenu
              onPickImages={pickImages}
              onPickDocuments={pickDocuments}
              disableImages={isStreaming || !isVisionEnabled}
              disableDocuments={isStreaming}
              hasImages={selectedImages.length > 0}
              hasDocuments={hasDocuments}
              onOpenManager={onOpenAttachmentManager}
              manageDisabled={!hasDocuments && selectedImages.length === 0}
              manageCount={(selectedImages?.length ?? 0) + (hasDocuments ? attachedDocumentsLength : 0)}
              ariaLabel="上传附件"
              className="h-10 w-10 rounded-xl border-0 bg-transparent"
              onOpenKnowledgeBase={onOpenKnowledgeBase}
              knowledgeBaseEnabled={knowledgeBaseEnabled}
              knowledgeBaseCount={knowledgeBaseCount}
            />
          </div>

          <div className="flex-1 overflow-hidden rounded-[1.7rem] border border-border/70 bg-[hsl(var(--surface))/0.9] shadow-[0_18px_42px_hsl(var(--background)/0.22)] backdrop-blur-md focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-ring/40 focus-within:ring-offset-2 focus-within:ring-offset-background">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onCompositionStart={onCompositionStart}
              onCompositionEnd={onCompositionEnd}
              placeholder={isStreaming ? 'AI正在思考中...' : placeholder}
              disabled={textareaDisabled}
              className="h-auto min-h-[56px] max-h-[240px] w-full resize-none border-0 bg-transparent px-5 py-4 text-left leading-[1.45] placeholder:text-muted-foreground transition-[height] duration-150 ease-out focus-visible:ring-0 focus-visible:ring-offset-0"
              rows={1}
            />
          </div>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <motion.button
                  onClick={isStreaming ? onStop : onSend}
                  disabled={desktopSendDisabled}
                  aria-label={isStreaming ? '停止生成' : '发送'}
                  className={`inline-flex h-14 w-14 items-center justify-center rounded-2xl shadow-[0_12px_26px_hsl(var(--background)/0.24)] transition-colors ${
                    isStreaming
                      ? 'bg-destructive text-destructive-foreground hover:opacity-90'
                      : 'bg-primary text-primary-foreground hover:bg-primary/90'
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
    </div>
  )
}
