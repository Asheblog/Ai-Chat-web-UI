'use client'

import type { ClipboardEventHandler, KeyboardEventHandler, MutableRefObject } from 'react'
import { useComposerOverlayControls } from './use-composer-overlay-controls'
import { Maximize2 } from 'lucide-react'
import type { ChatComposerImage } from '@/hooks/use-chat-composer'
import type { WorkspaceFile } from '@/features/chat/composer'
import { Textarea } from '@/components/ui/textarea'
import { ComposerAttachmentList } from './composer-attachment-list'
import { AttachmentUploadButton } from './attachment-upload-button'
import type { ComposerSkillOption } from './composer-types'
import type { McpConnectionOption, McpToolView } from '@/hooks/use-mcp-session-bindings'
import { SkillPanelSheet } from './skill-panel-sheet'
import { cn } from '@/lib/utils'
import { ComposerModelActions, type ComposerModelControlProps } from './composer-model-actions'
import { COMPOSER_TEXTAREA_BASE_CLASS } from './composer-shell-styles'
import { ComposerShell } from './composer-shell'
import { ComposerActiveCapabilities } from './composer-active-capabilities'
import { buildComposerCapabilityItems, countEnabledSkills } from './composer-capability-items'
import { ComposerToolsPanel } from './composer-tools-panel'
import {
  ComposerIconButton,
  composerToolbarScrollClass,
} from './composer-toolbar-primitives'

type ComposerModelBridge = Pick<ComposerModelControlProps, 'selectedModelId' | 'onModelChange' | 'reasoningControl'>

interface DesktopComposerProps extends ComposerModelBridge {
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
  traceEnabled: boolean
  canUseTrace: boolean
  onToggleTrace: (value: boolean) => void
  showExpand: boolean
  onExpandOpen: () => void
  onOpenAdvanced: () => void
  onOpenSessionPrompt: () => void
  onSend: () => void
  onStop: () => void
  desktopSendDisabled: boolean
  sendLockedReason: string | null
  // 知识库（工具面板的上下文入口）
  onOpenKnowledgeBase?: () => void
  knowledgeBaseEnabled?: boolean
  knowledgeBaseCount?: number
}

export function DesktopComposer({
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
  placeholder,
  textareaDisabled,
  isStreaming,
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
  traceEnabled,
  canUseTrace,
  onToggleTrace,
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
    <div className="hidden px-4 pb-5 pt-3 md:block md:px-6">
      <div className="w-full">
        <ComposerShell>
          <ComposerAttachmentList
            images={selectedImages}
            onRemoveImage={onRemoveImage}
            workspaceFiles={workspaceFiles}
            onRemoveWorkspaceFile={onRemoveWorkspaceFile}
            onRetryWorkspaceFile={onRetryWorkspaceFile}
            className={hasAttachments ? 'mb-2.5' : undefined}
          />

          <div data-composer-layer="text" className="relative min-w-0">
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
                'min-h-[64px] max-h-[200px] w-full lg:min-h-[68px]',
                showExpand && 'pr-12',
              )}
              rows={1}
            />

            {showExpand && (
              <ComposerIconButton
                className="absolute right-0 top-0 h-8 w-8 rounded-md"
                onClick={onExpandOpen}
                aria-label="全屏编辑"
                title="全屏编辑"
              >
                <Maximize2 className="h-4 w-4" />
              </ComposerIconButton>
            )}
          </div>

          {capabilities.length > 0 ? (
            <div data-composer-layer="capabilities" className="mt-2">
              <ComposerActiveCapabilities
                items={capabilities}
                mobile={false}
                onOverflowActivate={() => openTools('capabilities')}
                disabled={textareaDisabled}
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
                mobile={false}
                view={toolsView}
                onViewChange={setToolsView}
                onActivate={onActivateSkillPanel}
                disabled={textareaDisabled}
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
              selectorOpen={selectorOpen}
              selectorView={selectorView}
              onSelectorOpenChange={setSelectorOpen}
              modelDisabled={isStreaming} isStreaming={isStreaming}
              disabled={desktopSendDisabled} onSend={onSend} onStop={onStop}
              stopLabel="停止生成" sendTitle={sendTooltip}
            />
          </div>
        </ComposerShell>

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
    </div>
  )
}