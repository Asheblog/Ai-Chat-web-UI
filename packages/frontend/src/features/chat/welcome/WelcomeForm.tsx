import React, { useEffect, useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Maximize2 } from 'lucide-react'
import { ComposerAttachmentList } from '@/components/chat/composer-attachment-list'
import { AttachmentUploadButton } from '@/components/chat/attachment-upload-button'
import { KnowledgeBaseSelector } from '@/components/chat/knowledge-base-selector'
import { SkillPanelSheet } from '@/components/chat/skill-panel-sheet'
import { ComposerActiveCapabilities } from '@/components/chat/composer-active-capabilities'
import { buildComposerCapabilityItems } from '@/components/chat/composer-capability-items'
import { COMPOSER_TOOLS_HANDOFF_MS, ComposerToolsPanel, type ComposerToolsPanelView } from '@/components/chat/composer-tools-panel'
import { ComposerIconButton, composerToolbarScrollClass } from '@/components/chat/composer-toolbar-primitives'
import { cn } from '@/lib/utils'
import { COMPOSER_TEXTAREA_BASE_CLASS } from '@/components/chat/composer-shell-styles'
import { ComposerShell } from '@/components/chat/composer-shell'
import { ComposerModelActions } from '@/components/chat/composer-model-actions'
import type { WelcomeFormProps } from './welcome-form-types'
import { WelcomeDialogs } from './WelcomeDialogs'


export function WelcomeForm({ form, selectedModelId, onModelChange, modelDisabled }: WelcomeFormProps) {
  const {
    query,
    setIsComposing,
    textareaRef,
    basePlaceholder,
    mobilePlaceholder,
    mobileQuotaNotice,
    creationDisabled,
    isCreating,
    showExpand,
    isDragOver,
    dragHandlers,
    onTextareaChange,
    onKeyDown,
    onSubmit,
    onOpenExpand,
    expand,
    attachments,
    knowledgeBase,
    advancedOptions,
    advancedDialog,
    sessionPromptDialog,
  } = form
  const [isMobile, setIsMobile] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [toolsView, setToolsView] = useState<ComposerToolsPanelView>('capabilities')
  const [skillPanelOpen, setSkillPanelOpen] = useState(false)
  const [selectorOpen, setSelectorOpen] = useState(false)
  const [selectorView, setSelectorView] = useState<'models' | 'effort'>('models')

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(max-width: 767px)')
    const update = () => setIsMobile(mq.matches)
    update()
    const handle = (event: MediaQueryListEvent) => setIsMobile(event.matches)
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', handle)
      return () => mq.removeEventListener('change', handle)
    }
    mq.addListener(handle)
    return () => mq.removeListener(handle)
  }, [])

  const activePlaceholder = isMobile ? mobilePlaceholder : basePlaceholder
  const hasAttachments = attachments.selectedImages.length > 0 || attachments.workspaceFiles.length > 0
  const attachmentsCount = attachments.selectedImages.length + attachments.workspaceFiles.length
  const enabledSkillCount = advancedOptions.skillOptions.filter((skill) => skill.enabled).length
  // 空输入且无附件时只禁用发送；编辑区、附件、工具与模型在额度/权限允许时仍可用。
  const hasSendableContent = query.trim().length > 0 || hasAttachments
  const sendDisabled = creationDisabled || !hasSendableContent

  const openTools = (view: ComposerToolsPanelView) => {
    setToolsView(view)
    setToolsOpen(true)
  }
  const openSkillPanelFromTools = () => {
    runFromTools(() => setSkillPanelOpen(true))
  }
  // 面板里的上下文动作会打开另一层覆盖层：先收起面板，等 Sheet 退场后再执行。
  const runFromTools = (action?: () => void) => {
    setToolsOpen(false)
    if (action) window.setTimeout(action, COMPOSER_TOOLS_HANDOFF_MS)
  }
  const openEffortView = () => {
    setSelectorView('effort')
    setSelectorOpen(true)
  }
  const capabilities = buildComposerCapabilityItems(
    {
      thinkingEnabled: advancedOptions.thinkingEnabled,
      webSearchEnabled: advancedOptions.webSearchEnabled,
      canUseWebSearch: advancedOptions.canUseWebSearch,
      deepResearchEnabled: advancedOptions.deepResearchEnabled,
      pythonToolEnabled: advancedOptions.pythonToolEnabled,
      canUsePythonTool: advancedOptions.canUsePythonTool,
    },
    {
      // 欢迎页与聊天页共用同一组合选择器：思考标签直达强度视图。
      thinking: openEffortView,
      webSearch: () => openTools('search-scope'),
      deepResearch: () => openTools('capabilities'),
      python: () => openTools('capabilities'),
    },
  )

  return (
    <div
      className="relative w-full"
      {...(dragHandlers ?? {})}
    >
      {/* 拖拽上传遮罩 */}
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-signal/50 bg-signal/5 ">
          <div className="rounded-xl bg-surface px-5 py-3 text-center  ">
            <p className="text-sm font-medium text-foreground">松开以上传文件</p>
            <p className="mt-0.5 text-micro text-muted-foreground">推荐 PDF / Word / Excel / CSV / 文本 / 代码</p>
          </div>
        </div>
      )}

      <ComposerShell>
        <ComposerAttachmentList
          images={attachments.selectedImages}
          onRemoveImage={attachments.onRemoveImage}
          workspaceFiles={attachments.workspaceFiles}
          onRemoveWorkspaceFile={attachments.onRemoveWorkspaceFile}
          className={hasAttachments ? 'mb-2.5' : undefined}
        />

        <div data-composer-layer="text" className="relative min-w-0">
          <Textarea
            ref={textareaRef}
            value={query}
            placeholder={activePlaceholder}
            aria-label="输入消息"
            disabled={creationDisabled}
            onChange={(event) => onTextareaChange(event.target.value)}
            onKeyDown={onKeyDown}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onPaste={attachments.onPaste}
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
              onClick={onOpenExpand}
              disabled={creationDisabled}
              aria-label="全屏编辑"
              title="全屏编辑"
            >
              <Maximize2 className="h-4 w-4" />
            </ComposerIconButton>
          )}
        </div>

        {capabilities.length > 0 ? (
          <div data-composer-layer="capabilities" className="mt-2.5">
            <ComposerActiveCapabilities
              items={capabilities}
              mobile={isMobile}
              onOverflowActivate={() => openTools('capabilities')}
              disabled={creationDisabled}
            />
          </div>
        ) : null}

        <div data-composer-layer="actions" className="mt-2.5 flex min-w-0 items-center gap-2">
          <div className={cn(composerToolbarScrollClass, 'min-w-0 flex-1')}>
            <AttachmentUploadButton
              onPick={attachments.pickAttachments}
              disabled={creationDisabled}
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
              mobile={isMobile}
              view={toolsView}
              onViewChange={setToolsView}
              onActivate={advancedOptions.onActivateSkillPanel}
              disabled={creationDisabled}
              thinkingEnabled={advancedOptions.thinkingEnabled}
              onToggleThinking={advancedOptions.onToggleThinking}
              webSearchEnabled={advancedOptions.webSearchEnabled}
              onToggleWebSearch={advancedOptions.onToggleWebSearch}
              canUseWebSearch={advancedOptions.canUseWebSearch}
              webSearchDisabledNote={advancedOptions.webSearchDisabledNote}
              webSearchScope={advancedOptions.webSearchScope}
              showWebSearchScope={advancedOptions.showWebSearchScope}
              onWebSearchScopeChange={advancedOptions.onWebSearchScopeChange}
              deepResearchEnabled={advancedOptions.deepResearchEnabled}
              onToggleDeepResearch={advancedOptions.onToggleDeepResearch}
              pythonToolEnabled={advancedOptions.pythonToolEnabled}
              onTogglePythonTool={advancedOptions.onTogglePythonTool}
              canUsePythonTool={advancedOptions.canUsePythonTool}
              pythonToolDisabledNote={advancedOptions.pythonToolDisabledNote}
              knowledgeBaseEnabled={knowledgeBase.enabled}
              knowledgeBaseCount={knowledgeBase.selectedKbIds.length}
              onOpenKnowledgeBase={() => runFromTools(knowledgeBase.onOpenSelector)}
              onOpenSkillPanel={openSkillPanelFromTools}
              skillCount={enabledSkillCount}
              onOpenSessionPrompt={() => runFromTools(advancedOptions.onOpenSessionPrompt)}
              onOpenAdvanced={() => runFromTools(advancedOptions.onOpenAdvanced)}
            />
          </div>

          <ComposerModelActions
            selectedModelId={selectedModelId} onModelChange={onModelChange}
            reasoningControl={{ value: advancedOptions.effort, onChange: advancedOptions.onEffortChange }}
            selectorOpen={selectorOpen}
            selectorView={selectorView}
            onSelectorOpenChange={(open) => {
              setSelectorOpen(open)
              if (!open) setSelectorView('models')
            }}
            modelDisabled={modelDisabled} disabled={sendDisabled}
            isCreating={isCreating} onSend={onSubmit}
          />
        </div>
      </ComposerShell>

      {mobileQuotaNotice ? (
        <p className="mx-auto mt-2 max-w-3xl px-1 text-center text-[12px] leading-4 text-ink-tertiary">
          {mobileQuotaNotice}
        </p>
      ) : null}

      <SkillPanelSheet
        open={skillPanelOpen}
        onOpenChange={setSkillPanelOpen}
        webSearchEnabled={advancedOptions.webSearchEnabled}
        canUseWebSearch={advancedOptions.canUseWebSearch}
        showWebSearchScope={advancedOptions.showWebSearchScope}
        webSearchScope={advancedOptions.webSearchScope}
        onWebSearchScopeChange={advancedOptions.onWebSearchScopeChange}
        webSearchDisabledNote={advancedOptions.webSearchDisabledNote}
        pythonToolEnabled={advancedOptions.pythonToolEnabled}
        canUsePythonTool={advancedOptions.canUsePythonTool}
        pythonToolDisabledNote={advancedOptions.pythonToolDisabledNote}
        skillOptions={advancedOptions.skillOptions}
        onToggleSkillOption={advancedOptions.onToggleSkillOption}
        onActivate={advancedOptions.onActivateSkillPanel}
      />

      {/* 统一附件上传输入框 */}
      <input
        ref={attachments.attachmentInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={attachments.onAttachmentsSelected}
        disabled={creationDisabled}
      />

      {/* 知识库选择对话框 */}
      <KnowledgeBaseSelector
        open={knowledgeBase.selectorOpen}
        onOpenChange={knowledgeBase.onSelectorOpenChange}
        availableKbs={knowledgeBase.availableKbs}
        selectedKbIds={knowledgeBase.selectedKbIds}
        isLoading={knowledgeBase.isLoading}
        error={knowledgeBase.error}
        onToggle={knowledgeBase.onToggle}
        onSelectAll={knowledgeBase.onSelectAll}
        onClearAll={knowledgeBase.onClearAll}
        onRefresh={knowledgeBase.onRefresh}
      />
      <WelcomeDialogs
        expand={expand}
        advancedDialog={advancedDialog}
        sessionPromptDialog={sessionPromptDialog}
        onOpenExpand={onOpenExpand}
      />
    </div>
  )
}