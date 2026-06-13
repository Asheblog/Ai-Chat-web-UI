'use client'

import type { ClipboardEventHandler, KeyboardEventHandler, MutableRefObject } from 'react'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Maximize2, Plus, Send, Square } from 'lucide-react'
import type { ChatComposerImage } from '@/hooks/use-chat-composer'
import type { WorkspaceFile } from '@/features/chat/composer'
import { Textarea } from '@/components/ui/textarea'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ComposerAttachmentList } from './composer-attachment-list'
import { AttachmentUploadButton } from './attachment-upload-button'
import { sendButtonVariants } from '@/lib/animations/chat'
import { PlusMenuContent } from '@/components/plus-menu-content'
import type { ComposerSkillOption } from './chat-composer-panel'
import type { McpConnectionOption, McpToolView } from '@/hooks/use-mcp-session-bindings'
import { SkillPanelSheet } from './skill-panel-sheet'
import { cn } from '@/lib/utils'
import { COMPOSER_SHELL_BASE_CLASS, COMPOSER_TEXTAREA_BASE_CLASS } from './composer-shell-styles'
import {
  ComposerFeatureControls,
  ComposerIconButton,
  composerToolbarButtonClass,
  composerToolbarScrollClass,
} from './composer-toolbar-primitives'

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
  // 附件
  selectedImages: ChatComposerImage[]
  onRemoveImage: (index: number) => void
  workspaceFiles: WorkspaceFile[]
  onRemoveWorkspaceFile: (localId: string) => void
  onPickAttachments: () => void
  hasAttachments: boolean
  attachmentsCount: number
  // 功能开关
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
  onToggleSkillOption: (skillId: number, enabled: boolean) => void
  // MCP 绑定
  mcpGlobalEnabled?: boolean
  mcpConnectionOptions?: McpConnectionOption[]
  mcpSessionTools?: McpToolView[]
  mcpLoading?: boolean
  mcpError?: string | null
  onToggleMcpBinding?: (connectionId: number, enabled: boolean) => void
  traceEnabled: boolean
  canUseTrace: boolean
  onToggleTrace: (value: boolean) => void
  effort: 'low' | 'medium' | 'high' | 'max' | 'xhigh' | 'unset'
  onEffortChange: (value: 'low' | 'medium' | 'high' | 'max' | 'xhigh' | 'unset') => void
  showExpand: boolean
  onExpandOpen: () => void
  onOpenAdvanced: () => void
  onOpenSessionPrompt: () => void
  onSend: () => void
  onStop: () => void
  desktopSendDisabled: boolean
  sendLockedReason: string | null
  // 知识库（只在 ComposerFeatureControls 展示）
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
  workspaceFiles,
  onRemoveWorkspaceFile,
  onPickAttachments,
  hasAttachments,
  attachmentsCount,
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
  mcpGlobalEnabled,
  mcpConnectionOptions,
  mcpSessionTools,
  mcpLoading,
  mcpError,
  onToggleMcpBinding,
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
      <div className="mx-auto max-w-[calc(100vw-320px)] px-5 pb-5 pt-3 md:px-6">
        <ComposerAttachmentList
          images={selectedImages}
          onRemoveImage={onRemoveImage}
          workspaceFiles={workspaceFiles}
          onRemoveWorkspaceFile={onRemoveWorkspaceFile}
          className="mb-3"
        />
        <div className={cn(COMPOSER_SHELL_BASE_CLASS, 'relative p-4')}>
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
            placeholder={isStreaming ? 'AI正在思考中...' : placeholder}
            aria-label="输入消息"
            disabled={textareaDisabled}
            className={cn(
              COMPOSER_TEXTAREA_BASE_CLASS,
              'min-h-[64px] max-h-[200px] w-full text-sm lg:min-h-[68px]',
              showExpand && 'pr-12',
            )}
            rows={1}
          />

          {showExpand && (
            <ComposerIconButton
              className="absolute right-4 top-4 h-8 w-8 rounded-[7px]"
              onClick={onExpandOpen}
              aria-label="全屏编辑"
              title="全屏编辑"
            >
              <Maximize2 className="h-4 w-4" />
            </ComposerIconButton>
          )}

          <div className="mt-2 flex items-center justify-between gap-2">
            <div className={composerToolbarScrollClass}>
              <DropdownMenu open={plusOpen} onOpenChange={setPlusOpen}>
                <DropdownMenuTrigger asChild>
                  <button
                    className={composerToolbarButtonClass}
                    aria-label="更多操作"
                  >
                    <Plus className="h-[18px] w-[18px]" />
                  </button>
                </DropdownMenuTrigger>
                <PlusMenuContent
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

              <AttachmentUploadButton
                onPick={onPickAttachments}
                disabled={isStreaming}
                hasAttachments={hasAttachments}
                count={attachmentsCount}
                ariaLabel="上传附件"
                className={composerToolbarButtonClass}
              />

              <ComposerFeatureControls
                disabled={textareaDisabled}
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

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <motion.button
                    onClick={isStreaming ? onStop : onSend}
                    disabled={isStreaming ? false : desktopSendDisabled}
                    aria-label={isStreaming ? '停止生成' : '发送'}
                    className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] shadow-[0_10px_22px_rgba(37,99,235,0.18)] transition-colors disabled:shadow-none disabled:opacity-45 ${
                      isStreaming
                        ? 'bg-destructive text-destructive-foreground hover:opacity-90'
                        : 'bg-primary text-primary-foreground hover:bg-primary/90'
                    }`}
                    variants={sendButtonVariants}
                    animate="idle"
                    whileHover={!isStreaming ? 'hover' : undefined}
                    whileTap={!isStreaming ? 'tap' : undefined}
                  >
                    {isStreaming ? <Square className="h-[18px] w-[18px]" /> : <Send className="h-[18px] w-[18px]" />}
                  </motion.button>
                </TooltipTrigger>
                <TooltipContent>{sendTooltip}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
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
          mcpGlobalEnabled={mcpGlobalEnabled}
          mcpConnectionOptions={mcpConnectionOptions}
          mcpSessionTools={mcpSessionTools}
          mcpLoading={mcpLoading}
          mcpError={mcpError}
          onToggleMcpBinding={onToggleMcpBinding}
        />
      </div>
    </div>
  )
}
