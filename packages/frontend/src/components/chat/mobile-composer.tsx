'use client'

import type { ClipboardEventHandler, KeyboardEventHandler, MutableRefObject } from 'react'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Send, Square } from 'lucide-react'
import type { ChatComposerImage } from '@/hooks/use-chat-composer'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ChatImagePreview } from './chat-image-preview'
import { sendButtonVariants } from '@/lib/animations/chat'
import { PlusMenuContent } from '@/components/plus-menu-content'
import { AttachmentMenu } from '@/components/chat/attachment-menu'
import type { ComposerSkillOption } from './chat-composer-panel'
import { SkillPanelSheet } from './skill-panel-sheet'
import { cn } from '@/lib/utils'
import { COMPOSER_SHELL_BASE_CLASS, COMPOSER_TEXTAREA_BASE_CLASS } from './composer-shell-styles'
import {
  ComposerFeatureControls,
  ComposerIconButton,
  composerInnerEditorClass,
  composerToolbarButtonClass,
  composerToolbarScrollClass,
} from './composer-toolbar-primitives'

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
  effort: 'low' | 'medium' | 'high' | 'unset'
  onEffortChange: (value: 'low' | 'medium' | 'high' | 'unset') => void
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
  effort,
  onEffortChange,
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
  const [plusAdvancedOpen, setPlusAdvancedOpen] = useState(false)
  const [skillPanelOpen, setSkillPanelOpen] = useState(false)
  const openSkillPanelFromMenu = () => {
    setPlusOpen(false)
    window.setTimeout(() => {
      setSkillPanelOpen(true)
    }, 0)
  }
  const openAdvancedFromQuick = () => {
    setPlusOpen(false)
    window.setTimeout(() => {
      setPlusAdvancedOpen(true)
    }, 0)
  }

  return (
    <div className="px-3 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-2 md:hidden">
      <div className={cn(COMPOSER_SHELL_BASE_CLASS, 'rounded-[12px] px-2.5 py-2.5')}>
        <ChatImagePreview images={selectedImages} onRemove={onRemoveImage} className="mb-2" />
        <div className={composerInnerEditorClass}>
          <Textarea
            ref={textareaRef}
            placeholder={placeholder}
            aria-label="输入消息"
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
            className={cn(COMPOSER_TEXTAREA_BASE_CLASS, 'min-h-[64px] max-h-[220px] w-full px-3 py-3 text-sm')}
            rows={1}
            disabled={isStreaming}
          />
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <div className={cn(composerToolbarScrollClass, 'flex-1')}>
            <Popover open={plusOpen} onOpenChange={setPlusOpen}>
              <PopoverTrigger asChild>
                <ComposerIconButton active={plusOpen} aria-label="更多操作">
                  <Plus className="h-4 w-4" />
                </ComposerIconButton>
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="start"
                sideOffset={10}
                className="w-[min(92vw,22rem)] rounded-2xl border-border/80 bg-popover/95 p-2 shadow-[0_18px_40px_hsl(var(--background)/0.35)] backdrop-blur-xl"
              >
                <PlusMenuContent
                  effort={effort}
                  onEffortChange={onEffortChange}
                  onOpenSkillPanel={openSkillPanelFromMenu}
                  canUseTrace={canUseTrace}
                  traceEnabled={traceEnabled}
                  onToggleTrace={(checked) => onToggleTrace(Boolean(checked))}
                  showAdvancedRequestAction={false}
                  showSessionPromptAction={false}
                  extraAction={{
                    title: '更多设置',
                    description: '编辑请求头与会话系统提示词。',
                    onClick: openAdvancedFromQuick,
                  }}
                  container="plain"
                  onActionComplete={() => setPlusOpen(false)}
                />
              </PopoverContent>
            </Popover>

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
              className={composerToolbarButtonClass}
              menuMode="sheet"
              onOpenKnowledgeBase={onOpenKnowledgeBase}
              knowledgeBaseEnabled={knowledgeBaseEnabled}
              knowledgeBaseCount={knowledgeBaseCount}
            />

            <ComposerFeatureControls
              disabled={isStreaming}
              thinkingEnabled={thinkingEnabled}
              onToggleThinking={onToggleThinking}
              webSearchEnabled={webSearchEnabled}
              onToggleWebSearch={onToggleWebSearch}
              canUseWebSearch={canUseWebSearch}
              webSearchDisabledNote={webSearchDisabledNote}
              pythonToolEnabled={pythonToolEnabled}
              onTogglePythonTool={onTogglePythonTool}
              canUsePythonTool={canUsePythonTool}
              pythonToolDisabledNote={pythonToolDisabledNote}
              knowledgeBaseEnabled={knowledgeBaseEnabled}
              knowledgeBaseCount={knowledgeBaseCount}
              onOpenKnowledgeBase={onOpenKnowledgeBase}
            />
          </div>

          <motion.div
            variants={sendButtonVariants}
            animate="idle"
            whileHover={!isStreaming ? 'hover' : undefined}
            whileTap={!isStreaming ? 'tap' : undefined}
            className="shrink-0"
          >
            <Button
              type="button"
              className={`h-9 w-9 rounded-[10px] p-0 shadow-[0_10px_22px_rgba(37,99,235,0.18)] ${
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
              {isStreaming ? <Square className="h-[18px] w-[18px]" /> : <Send className="h-[18px] w-[18px]" />}
            </Button>
          </motion.div>
        </div>
      </div>

      <SkillPanelSheet
        open={skillPanelOpen}
        onOpenChange={setSkillPanelOpen}
        webSearchEnabled={webSearchEnabled}
        canUseWebSearch={canUseWebSearch}
        showWebSearchScope={showWebSearchScope}
        webSearchScope={webSearchScope}
        onWebSearchScopeChange={onWebSearchScopeChange}
        webSearchDisabledNote={webSearchDisabledNote}
        pythonToolEnabled={pythonToolEnabled}
        canUsePythonTool={canUsePythonTool}
        pythonToolDisabledNote={pythonToolDisabledNote}
        skillOptions={skillOptions}
        onToggleSkillOption={onToggleSkillOption}
      />

      <Sheet open={plusAdvancedOpen} onOpenChange={setPlusAdvancedOpen}>
        <SheetContent
          side="bottom"
          dialogTitle="更多设置"
          className="rounded-t-3xl border-border/80 bg-card/95 pb-[calc(env(safe-area-inset-bottom)+20px)]"
        >
          <div className="px-4 pt-4 pb-2">
            <h3 className="text-base font-semibold text-foreground">更多设置</h3>
            <p className="mt-1 text-xs text-muted-foreground">这里放低频操作，避免主输入区拥挤。</p>
          </div>
          <div className="max-h-[70vh] overflow-y-auto px-4 pb-2">
            <PlusMenuContent
              showControlCard={false}
              showSkillPanelAction={false}
              onOpenAdvanced={onOpenAdvanced}
              onOpenSessionPrompt={onOpenSessionPrompt}
              container="plain"
              onActionComplete={() => setPlusAdvancedOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
