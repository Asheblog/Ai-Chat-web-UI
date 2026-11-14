'use client'

import type { ClipboardEventHandler, KeyboardEventHandler, MutableRefObject } from 'react'
import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { ChatComposerImage } from '@/hooks/use-chat-composer'
import type { WorkspaceFile } from '@/features/chat/composer'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ComposerAttachmentList } from './composer-attachment-list'
import { AttachmentUploadButton } from './attachment-upload-button'
import { PlusMenuContent } from '@/components/plus-menu-content'
import type { ComposerSkillOption } from './composer-types'
import type { McpConnectionOption, McpToolView } from '@/hooks/use-mcp-session-bindings'
import { SkillPanelSheet } from './skill-panel-sheet'
import { cn } from '@/lib/utils'
import { ComposerModelActions, type ComposerModelControlProps } from './composer-model-actions'
import { COMPOSER_TEXTAREA_BASE_CLASS } from './composer-shell-styles'
import {
  ComposerFeatureControls,
  ComposerIconButton,
  composerInnerEditorClass,
  composerToolbarButtonClass,
  composerToolbarIconClass,
  composerToolbarScrollClass,
} from './composer-toolbar-primitives'

interface MobileComposerProps extends ComposerModelControlProps {
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
  effort: 'low' | 'medium' | 'high' | 'max' | 'xhigh' | 'unset'
  onEffortChange: (value: 'low' | 'medium' | 'high' | 'max' | 'xhigh' | 'unset') => void
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
  deepResearchEnabled: boolean
  onToggleDeepResearch: (value: boolean) => void
  skillOptions: ComposerSkillOption[]
  onToggleSkillOption: (skillId: number, enabled: boolean) => void
  // MCP 绑定
  mcpGlobalEnabled?: boolean
  mcpConnectionOptions?: McpConnectionOption[]
  mcpSessionTools?: McpToolView[]
  mcpLoading?: boolean
  mcpError?: string | null
  onToggleMcpBinding?: (connectionId: number, enabled: boolean) => void
  onActivateSkillPanel?: () => void
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
  selectedModelId,
  onModelChange,
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
  workspaceFiles,
  onRemoveWorkspaceFile,
  onPickAttachments,
  hasAttachments,
  attachmentsCount,
  thinkingEnabled,
  onToggleThinking,
  effort,
  onEffortChange,
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
  deepResearchEnabled,
  onToggleDeepResearch,
  skillOptions,
  onToggleSkillOption,
  mcpGlobalEnabled,
  mcpConnectionOptions,
  mcpSessionTools,
  mcpLoading,
  mcpError,
  onToggleMcpBinding,
  onActivateSkillPanel,
  placeholder,
  traceEnabled,
  canUseTrace,
  onToggleTrace,
  onOpenAdvanced,
  onOpenSessionPrompt,
  onOpenKnowledgeBase,
  knowledgeBaseEnabled,
  knowledgeBaseCount,
}: MobileComposerProps) {
  const hasReadyFiles = workspaceFiles.some((f) => f.status === 'ready')
  const disabled = sendLocked || (!input.trim() && selectedImages.length === 0 && !hasReadyFiles)
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
    <div className="min-w-0 px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-2 md:hidden">
      <ComposerAttachmentList
        images={selectedImages}
        onRemoveImage={onRemoveImage}
        workspaceFiles={workspaceFiles}
        onRemoveWorkspaceFile={onRemoveWorkspaceFile}
        className="mb-2"
      />
      <div className={cn(composerInnerEditorClass, 'p-3.5')}>
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
          className={cn(COMPOSER_TEXTAREA_BASE_CLASS, 'min-h-[64px] max-h-[220px] w-full px-0 py-0 text-sm')}
          rows={1}
          disabled={isStreaming}
        />

      <div className="mt-3 grid min-w-0 grid-cols-1 items-center gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:gap-2">
        <div className={cn(composerToolbarScrollClass, 'flex-1')}>
          <Popover open={plusOpen} onOpenChange={setPlusOpen}>
            <PopoverTrigger asChild>
              <ComposerIconButton active={plusOpen} aria-label="更多操作">
                <Plus className={composerToolbarIconClass} />
              </ComposerIconButton>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="start"
              sideOffset={10}
              className="w-[min(92vw,22rem)] rounded-lg border-border bg-surface p-2 shadow-[0_8px_24px_hsl(var(--foreground)/0.08)] "
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

          <AttachmentUploadButton
            onPick={onPickAttachments}
            disabled={isStreaming}
            hasAttachments={hasAttachments}
            count={attachmentsCount}
            ariaLabel="上传附件"
            className={composerToolbarButtonClass}
          />

          <ComposerFeatureControls
            disabled={isStreaming}
            thinkingEnabled={thinkingEnabled}
            onToggleThinking={onToggleThinking}
            webSearchEnabled={webSearchEnabled}
            onToggleWebSearch={onToggleWebSearch}
            canUseWebSearch={canUseWebSearch}
            webSearchDisabledNote={webSearchDisabledNote}
            deepResearchEnabled={deepResearchEnabled}
            onToggleDeepResearch={onToggleDeepResearch}
            pythonToolEnabled={pythonToolEnabled}
            onTogglePythonTool={onTogglePythonTool}
            canUsePythonTool={canUsePythonTool}
            pythonToolDisabledNote={pythonToolDisabledNote}
            knowledgeBaseEnabled={knowledgeBaseEnabled}
            knowledgeBaseCount={knowledgeBaseCount}
            onOpenKnowledgeBase={onOpenKnowledgeBase}
          />
        </div>

        <ComposerModelActions
          selectedModelId={selectedModelId} onModelChange={onModelChange}
          modelDisabled={isStreaming} isStreaming={isStreaming}
          disabled={disabled} onSend={onSend} onStop={onStop}
          sendTitle={!isStreaming && sendLocked ? sendLockedReason ?? undefined : undefined}
        />
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
        onActivate={onActivateSkillPanel}
      />

      <Sheet open={plusAdvancedOpen} onOpenChange={setPlusAdvancedOpen}>
        <SheetContent
          side="bottom"
          dialogTitle="更多设置"
          className="rounded-t-3xl border-border bg-surface pb-[calc(env(safe-area-inset-bottom)+20px)]"
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
