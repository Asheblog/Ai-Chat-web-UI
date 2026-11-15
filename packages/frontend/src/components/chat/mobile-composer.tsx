'use client'

import type { ClipboardEventHandler, KeyboardEventHandler, MutableRefObject } from 'react'
import { useComposerOverlayControls } from './use-composer-overlay-controls'
import { Maximize2 } from 'lucide-react'
import type { ChatComposerImage } from '@/hooks/use-chat-composer'
import type { WorkspaceFile } from '@/features/chat/composer'
import { Textarea } from '@/components/ui/textarea'
import { formatModelShortName } from '@/components/model-selector'
import { ComposerAttachmentList } from './composer-attachment-list'
import { AttachmentUploadButton } from './attachment-upload-button'
import type { ComposerSkillOption } from './composer-types'
import type { McpConnectionOption, McpToolView } from '@/hooks/use-mcp-session-bindings'
import { SkillPanelSheet } from './skill-panel-sheet'
import { cn } from '@/lib/utils'
import { ComposerModelActions, type ComposerModelControlProps } from './composer-model-actions'
import { COMPOSER_TEXTAREA_BASE_CLASS } from './composer-shell-styles'
import { ComposerActiveCapabilities } from './composer-active-capabilities'
import { buildComposerCapabilityItems, countEnabledSkills } from './composer-capability-items'
import { ComposerToolsPanel } from './composer-tools-panel'
import {
  ComposerIconButton,
  composerInnerEditorClass,
  composerToolbarScrollClass,
} from './composer-toolbar-primitives'

type ComposerModelBridge = Pick<ComposerModelControlProps, 'selectedModelId' | 'onModelChange' | 'reasoningControl'>

interface MobileComposerProps extends ComposerModelBridge {
  input: string
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>
  onInputChange: (value: string) => void
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>
  onPaste: ClipboardEventHandler<HTMLTextAreaElement>
  onCompositionStart: () => void
  onCompositionEnd: () => void
  isStreaming: boolean
  showExpand: boolean
  onExpandOpen: () => void
  sendLocked: boolean
  sendLockedReason: string | null
  onSend: () => void
  onStop: () => void
  // 附件
  selectedImages: ChatComposerImage[]
  onRemoveImage: (index: number) => void
  workspaceFiles: WorkspaceFile[]
  onRemoveWorkspaceFile: (localId: string) => void
  onRetryWorkspaceFile?: (localId: string) => void
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
  reasoningControl,
  textareaRef,
  onInputChange,
  onKeyDown,
  onPaste,
  onCompositionStart,
  onCompositionEnd,
  isStreaming,
  showExpand,
  onExpandOpen,
  sendLocked,
  sendLockedReason,
  onSend,
  onStop,
  selectedImages,
  onRemoveImage,
  workspaceFiles,
  onRemoveWorkspaceFile,
  onRetryWorkspaceFile,
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
  const { toolsOpen, setToolsOpen, toolsView, setToolsView, skillPanelOpen, setSkillPanelOpen,
    selectorOpen, setSelectorOpen, selectorView, openTools, runFromTools, openSkillPanelFromTools, openEffortView } = useComposerOverlayControls()
  const capabilities = buildComposerCapabilityItems(
    {
      thinkingEnabled,
      webSearchEnabled,
      canUseWebSearch,
      deepResearchEnabled,
      pythonToolEnabled,
      canUsePythonTool,
    },
    {
      thinking: openEffortView,
      webSearch: () => openTools('search-scope'),
      deepResearch: () => openTools('capabilities'),
      python: () => openTools('capabilities'),
    },
  )

  return (
    <div className="min-w-0 px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-2 md:hidden">
      <div className={cn(composerInnerEditorClass, 'p-3.5')}>
        <ComposerAttachmentList
          images={selectedImages}
          onRemoveImage={onRemoveImage}
          workspaceFiles={workspaceFiles}
          onRemoveWorkspaceFile={onRemoveWorkspaceFile}
          onRetryWorkspaceFile={onRetryWorkspaceFile}
          className={hasAttachments ? 'mb-2' : undefined}
        />

        <div data-composer-layer="text" className="relative min-w-0">
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
            className={cn(
              COMPOSER_TEXTAREA_BASE_CLASS,
              'min-h-[64px] max-h-[220px] w-full px-0 py-0',
              showExpand && 'pr-11',
            )}
            rows={1}
            disabled={isStreaming}
          />

          {showExpand ? (
            <ComposerIconButton
              className="absolute right-0 top-0 h-11 w-11 rounded-md"
              onClick={onExpandOpen}
              disabled={isStreaming}
              aria-label="全屏编辑"
              title="全屏编辑"
            >
              <Maximize2 className="h-[18px] w-[18px]" />
            </ComposerIconButton>
          ) : null}
        </div>

        {capabilities.length > 0 ? (
          <div data-composer-layer="capabilities" className="mt-2">
            <ComposerActiveCapabilities
              items={capabilities}
              mobile
              onOverflowActivate={() => openTools('capabilities')}
              disabled={isStreaming}
            />
          </div>
        ) : null}

        <div data-composer-layer="actions" className="mt-2 flex min-w-0 items-center gap-2">
          <div className={cn(composerToolbarScrollClass, 'min-w-0 shrink md:flex-1')}>
            <AttachmentUploadButton
              onPick={onPickAttachments}
              disabled={isStreaming}
              hasAttachments={hasAttachments}
              count={attachmentsCount}
              ariaLabel="上传附件"
            />

            <ComposerToolsPanel
              open={toolsOpen}
              onOpenChange={(open) => {
                setToolsOpen(open)
                if (!open) setToolsView('capabilities')
              }}
              mobile
              view={toolsView}
              onViewChange={setToolsView}
              onActivate={onActivateSkillPanel}
              disabled={isStreaming}
              thinkingEnabled={thinkingEnabled}
              onToggleThinking={onToggleThinking}
              webSearchEnabled={webSearchEnabled}
              onToggleWebSearch={onToggleWebSearch}
              canUseWebSearch={canUseWebSearch}
              webSearchDisabledNote={webSearchDisabledNote}
              webSearchScope={webSearchScope}
              showWebSearchScope={showWebSearchScope}
              onWebSearchScopeChange={onWebSearchScopeChange}
              deepResearchEnabled={deepResearchEnabled}
              onToggleDeepResearch={onToggleDeepResearch}
              pythonToolEnabled={pythonToolEnabled}
              onTogglePythonTool={onTogglePythonTool}
              canUsePythonTool={canUsePythonTool}
              pythonToolDisabledNote={pythonToolDisabledNote}
              knowledgeBaseEnabled={knowledgeBaseEnabled}
              knowledgeBaseCount={knowledgeBaseCount}
              onOpenKnowledgeBase={onOpenKnowledgeBase ? () => runFromTools(onOpenKnowledgeBase) : undefined}
              onOpenSkillPanel={onActivateSkillPanel ? openSkillPanelFromTools : undefined}
              skillCount={countEnabledSkills(skillOptions)}
              onOpenSessionPrompt={onOpenSessionPrompt ? () => runFromTools(onOpenSessionPrompt) : undefined}
              onOpenAdvanced={() => runFromTools(onOpenAdvanced)}
              traceEnabled={traceEnabled}
              canUseTrace={canUseTrace}
              onToggleTrace={onToggleTrace}
            />
          </div>

          <ComposerModelActions
            selectedModelId={selectedModelId} onModelChange={onModelChange}
            reasoningControl={reasoningControl}
            formatModelName={formatModelShortName}
            selectorOpen={selectorOpen}
            selectorView={selectorView}
            onSelectorOpenChange={setSelectorOpen}
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
    </div>
  )
}