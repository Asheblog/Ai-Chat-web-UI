'use client'

import { type ChangeEvent, type ClipboardEventHandler, type KeyboardEventHandler, type MutableRefObject, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ChatComposerImage, AttachedDocument } from '@/hooks/use-chat-composer'
import { MobileComposer } from './mobile-composer'
import { DesktopComposer } from './desktop-composer'
import { ExpandEditorDialog } from './expand-editor-dialog'
import { CustomRequestEditor } from './custom-request-editor'
import { Button } from '@/components/ui/button'
import { AttachmentTray, DocumentAttachmentInput } from '@/features/chat/composer'
import { KnowledgeBaseSelector, KnowledgeBaseIndicator, type KnowledgeBaseItem } from './knowledge-base-selector'

interface ImageLimitConfig {
  maxCount: number
  maxMb: number
  maxEdge: number
  maxTotalMb: number
}

export interface ChatComposerPanelProps {
  input: string
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>
  showExpand: boolean
  isStreaming: boolean
  sendLocked: boolean
  sendLockedReason: string | null
  selectedImages: ChatComposerImage[]
  thinkingEnabled: boolean
  webSearchEnabled: boolean
  webSearchScope: string
  showWebSearchScope: boolean
  canUseWebSearch: boolean
  webSearchDisabledNote?: string
  pythonToolEnabled: boolean
  onTogglePythonTool: (value: boolean) => void
  canUsePythonTool: boolean
  pythonToolDisabledNote?: string
  isVisionEnabled: boolean
  traceEnabled: boolean
  canUseTrace: boolean
  effort: 'low' | 'medium' | 'high' | 'unset'
  basePlaceholder: string
  mobilePlaceholder: string
  textareaDisabled: boolean
  desktopSendDisabled: boolean
  pickImages: () => void
  onRemoveImage: (index: number) => void
  onInputChange: (value: string) => void
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>
  onPaste: ClipboardEventHandler<HTMLTextAreaElement>
  onCompositionStart: () => void
  onCompositionEnd: () => void
  onSend: () => void
  onStop: () => void
  onToggleThinking: (value: boolean) => void
  onToggleWebSearch: (value: boolean) => void
  onWebSearchScopeChange: (value: string) => void
  onToggleTrace: (value: boolean) => void
  onEffortChange: (value: 'low' | 'medium' | 'high' | 'unset') => void
  fileInputRef: MutableRefObject<HTMLInputElement | null>
  onFilesSelected: (event: ChangeEvent<HTMLInputElement>) => void
  imageLimits: ImageLimitConfig
  customHeaders: Array<{ name: string; value: string }>
  onAddCustomHeader: () => void
  onCustomHeaderChange: (index: number, field: 'name' | 'value', value: string) => void
  onRemoveCustomHeader: (index: number) => void
  canAddCustomHeader: boolean
  customBody: string
  onCustomBodyChange: (value: string) => void
  customBodyError?: string | null
  sessionPromptDraft: string
  sessionPromptSourceLabel: string
  sessionPromptPlaceholder: string
  onSessionPromptChange: (value: string) => void
  onSessionPromptSave: () => void
  sessionPromptSaving: boolean
  // 文档附件
  documentInputRef: MutableRefObject<HTMLInputElement | null>
  attachedDocuments: AttachedDocument[]
  isUploadingDocuments: boolean
  hasDocuments: boolean
  hasProcessingDocuments: boolean
  pickDocuments: () => void
  onDocumentFilesSelected: (event: ChangeEvent<HTMLInputElement>) => void
  onRemoveDocument: (documentId: number) => void
  onCancelDocument: (documentId: number) => void
  // 知识库
  knowledgeBaseEnabled?: boolean
  knowledgeBases?: KnowledgeBaseItem[]
  selectedKnowledgeBaseIds?: number[]
  onToggleKnowledgeBase?: (id: number) => void
  onSelectAllKnowledgeBases?: () => void
  onClearKnowledgeBases?: () => void
  onRefreshKnowledgeBases?: () => void
  isLoadingKnowledgeBases?: boolean
}

export function ChatComposerPanel({
  input,
  textareaRef,
  showExpand,
  isStreaming,
  sendLocked,
  sendLockedReason,
  selectedImages,
  thinkingEnabled,
  webSearchEnabled,
  webSearchScope,
  showWebSearchScope,
  canUseWebSearch,
  webSearchDisabledNote,
  pythonToolEnabled,
  onTogglePythonTool,
  canUsePythonTool,
  pythonToolDisabledNote,
  isVisionEnabled,
  traceEnabled,
  canUseTrace,
  effort,
  basePlaceholder,
  mobilePlaceholder,
  textareaDisabled,
  desktopSendDisabled,
  pickImages,
  onRemoveImage,
  onInputChange,
  onKeyDown,
  onPaste,
  onCompositionStart,
  onCompositionEnd,
  onSend,
  onStop,
  onToggleThinking,
  onToggleWebSearch,
  onWebSearchScopeChange,
  onToggleTrace,
  onEffortChange,
  fileInputRef,
  onFilesSelected,
  imageLimits,
  customHeaders,
  onAddCustomHeader,
  onCustomHeaderChange,
  onRemoveCustomHeader,
  canAddCustomHeader,
  customBody,
  onCustomBodyChange,
  customBodyError,
  sessionPromptDraft,
  sessionPromptSaving,
  sessionPromptSourceLabel,
  sessionPromptPlaceholder,
  onSessionPromptChange,
  onSessionPromptSave,
  // 文档附件
  documentInputRef,
  attachedDocuments,
  isUploadingDocuments,
  hasDocuments,
  hasProcessingDocuments,
  pickDocuments,
  onDocumentFilesSelected,
  onRemoveDocument,
  onCancelDocument,
  // 知识库
  knowledgeBaseEnabled,
  knowledgeBases,
  selectedKnowledgeBaseIds,
  onToggleKnowledgeBase,
  onSelectAllKnowledgeBases,
  onClearKnowledgeBases,
  onRefreshKnowledgeBases,
  isLoadingKnowledgeBases,
}: ChatComposerPanelProps) {
  const portalRoot = useMemo(() => (typeof document !== 'undefined' ? document.body : null), [])
  const [expandOpen, setExpandOpen] = useState(false)
  const [expandDraft, setExpandDraft] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [sessionPromptOpen, setSessionPromptOpen] = useState(false)
  const [attachmentViewerOpen, setAttachmentViewerOpen] = useState(false)
  const [kbSelectorOpen, setKbSelectorOpen] = useState(false)
  const attachmentsCount = selectedImages.length + attachedDocuments.length

  const openExpand = () => {
    setExpandDraft(input)
    setExpandOpen(true)
  }

  const closeExpand = () => setExpandOpen(false)

  const applyExpand = () => {
    onInputChange(expandDraft)
    setExpandOpen(false)
  }

  return (
    <div className="sticky bottom-0 w-full">
      {advancedOpen && portalRoot
        ? createPortal(
          <div
            className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 px-4 py-8"
            role="dialog"
            aria-modal="true"
            aria-label="高级请求定制"
            onClick={() => setAdvancedOpen(false)}
          >
            <div
              className="w-full max-w-5xl rounded-2xl bg-background shadow-2xl border border-border/70 max-h-full overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
                <div>
                  <p className="text-lg font-semibold leading-none">高级请求定制</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    为本次消息添加自定义请求体和请求头。核心字段（model/messages/stream）已锁定，敏感头会被忽略。
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setAdvancedOpen(false)} aria-label="关闭">
                  ✕
                </Button>
              </div>
              <div className="px-5 py-4">
                <CustomRequestEditor
                  customHeaders={customHeaders}
                  onAddHeader={onAddCustomHeader}
                  onHeaderChange={onCustomHeaderChange}
                  onRemoveHeader={onRemoveCustomHeader}
                  canAddHeader={canAddCustomHeader}
                  customBody={customBody}
                  onCustomBodyChange={onCustomBodyChange}
                  customBodyError={customBodyError}
                />
              </div>
              <div className="flex justify-end border-t border-border/60 px-5 py-3">
                <Button variant="secondary" onClick={() => setAdvancedOpen(false)}>
                  完成
                </Button>
              </div>
            </div>
          </div>,
          portalRoot
        )
        : null}

      {sessionPromptOpen && portalRoot
        ? createPortal(
          <div
            className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 px-4 py-6"
            role="dialog"
            aria-modal="true"
            aria-label="编辑会话系统提示词"
            onClick={() => setSessionPromptOpen(false)}
          >
            <div
              className="w-full max-w-2xl rounded-2xl bg-background shadow-2xl border border-border/70 max-h-[80vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
                <div>
                  <p className="text-lg font-semibold leading-none">会话系统提示词</p>
                  <p className="text-sm text-muted-foreground mt-1">{sessionPromptSourceLabel}</p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setSessionPromptOpen(false)} aria-label="关闭">
                  ✕
                </Button>
              </div>
              <div className="px-5 py-4 space-y-3">
                <textarea
                  value={sessionPromptDraft}
                  onChange={(e) => onSessionPromptChange(e.target.value)}
                  rows={6}
                  placeholder={sessionPromptPlaceholder}
                  className="w-full rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-sm leading-relaxed focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                />
                <p className="text-xs text-muted-foreground">
                  {'生效顺序：会话 > 个人 > 全局；支持 {day time}（自动替换为服务器当前时间）。留空继承上级，三层均为空时默认使用“今天日期是{day time}”。'}
                </p>
              </div>
              <div className="flex items-center justify-between border-t border-border/60 px-5 py-3">
                <Button variant="ghost" onClick={() => onSessionPromptChange('')} disabled={sessionPromptSaving}>
                  清空
                </Button>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={() => setSessionPromptOpen(false)} disabled={sessionPromptSaving}>
                    取消
                  </Button>
                  <Button
                    onClick={async () => {
                      await onSessionPromptSave()
                      setSessionPromptOpen(false)
                    }}
                    disabled={sessionPromptSaving}
                  >
                    {sessionPromptSaving ? '保存中...' : '保存提示词'}
                  </Button>
                </div>
              </div>
            </div>
          </div>,
          portalRoot
        )
        : null}

      <MobileComposer
        input={input}
        textareaRef={textareaRef}
        onInputChange={onInputChange}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        isStreaming={isStreaming}
        sendLocked={sendLocked}
        sendLockedReason={sendLockedReason}
        onSend={onSend}
        onStop={onStop}
        selectedImages={selectedImages}
        onRemoveImage={onRemoveImage}
        thinkingEnabled={thinkingEnabled}
        onToggleThinking={onToggleThinking}
        webSearchEnabled={webSearchEnabled}
        onToggleWebSearch={onToggleWebSearch}
        webSearchScope={webSearchScope}
        onWebSearchScopeChange={onWebSearchScopeChange}
        showWebSearchScope={showWebSearchScope}
        pickImages={pickImages}
        pickDocuments={pickDocuments}
        hasDocuments={hasDocuments}
        hasProcessingDocuments={hasProcessingDocuments}
        canUseWebSearch={canUseWebSearch}
        webSearchDisabledNote={webSearchDisabledNote}
        pythonToolEnabled={pythonToolEnabled}
        onTogglePythonTool={onTogglePythonTool}
        canUsePythonTool={canUsePythonTool}
        pythonToolDisabledNote={pythonToolDisabledNote}
        isVisionEnabled={isVisionEnabled}
        placeholder={mobilePlaceholder}
        traceEnabled={traceEnabled}
        canUseTrace={canUseTrace}
        onToggleTrace={onToggleTrace}
        onOpenAdvanced={() => setAdvancedOpen(true)}
        onOpenSessionPrompt={() => setSessionPromptOpen(true)}
        onOpenAttachmentManager={() => setAttachmentViewerOpen(true)}
        attachmentsCount={attachmentsCount}
      />

      <DesktopComposer
        input={input}
        textareaRef={textareaRef}
        onInputChange={onInputChange}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        placeholder={basePlaceholder}
        textareaDisabled={textareaDisabled}
        isStreaming={isStreaming}
        selectedImages={selectedImages}
        onRemoveImage={onRemoveImage}
        pickImages={pickImages}
        isVisionEnabled={isVisionEnabled}
        imageLimits={imageLimits}
        thinkingEnabled={thinkingEnabled}
        onToggleThinking={onToggleThinking}
        webSearchEnabled={webSearchEnabled}
        onToggleWebSearch={onToggleWebSearch}
        webSearchScope={webSearchScope}
        onWebSearchScopeChange={onWebSearchScopeChange}
        showWebSearchScope={showWebSearchScope}
        canUseWebSearch={canUseWebSearch}
        webSearchDisabledNote={webSearchDisabledNote}
        pythonToolEnabled={pythonToolEnabled}
        onTogglePythonTool={onTogglePythonTool}
        canUsePythonTool={canUsePythonTool}
        pythonToolDisabledNote={pythonToolDisabledNote}
        traceEnabled={traceEnabled}
        canUseTrace={canUseTrace}
        onToggleTrace={onToggleTrace}
        effort={effort}
        onEffortChange={onEffortChange}
        showExpand={showExpand}
        onExpandOpen={openExpand}
        onOpenAdvanced={() => setAdvancedOpen(true)}
        onOpenSessionPrompt={() => setSessionPromptOpen(true)}
        onSend={onSend}
        onStop={onStop}
        desktopSendDisabled={desktopSendDisabled}
        sendLockedReason={sendLockedReason}
        hasDocuments={hasDocuments}
        pickDocuments={pickDocuments}
        onOpenAttachmentManager={() => setAttachmentViewerOpen(true)}
        attachedDocumentsLength={attachedDocuments.length}
        // 知识库
        onOpenKnowledgeBase={() => setKbSelectorOpen(true)}
        knowledgeBaseEnabled={knowledgeBaseEnabled}
        knowledgeBaseCount={selectedKnowledgeBaseIds?.length ?? 0}
      />

      {/* 知识库选择对话框 */}
      <KnowledgeBaseSelector
        open={kbSelectorOpen}
        onOpenChange={setKbSelectorOpen}
        availableKbs={knowledgeBases ?? []}
        selectedKbIds={selectedKnowledgeBaseIds ?? []}
        isLoading={isLoadingKnowledgeBases ?? false}
        error={null}
        onToggle={onToggleKnowledgeBase ?? (() => { })}
        onSelectAll={onSelectAllKnowledgeBases ?? (() => { })}
        onClearAll={onClearKnowledgeBases ?? (() => { })}
        onRefresh={async () => { onRefreshKnowledgeBases?.() }}
      />

      {attachmentViewerOpen && (
        <AttachmentTray
          documents={attachedDocuments}
          onRemove={onRemoveDocument}
          onCancel={onCancelDocument}
          open={attachmentViewerOpen}
          onOpenChange={setAttachmentViewerOpen}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={onFilesSelected}
        disabled={!isVisionEnabled}
      />

      {/* 文档上传输入框 */}
      <DocumentAttachmentInput
        inputRef={documentInputRef}
        onFilesSelected={onDocumentFilesSelected}
      />

      <ExpandEditorDialog
        open={expandOpen}
        draft={expandDraft}
        onDraftChange={setExpandDraft}
        onClose={closeExpand}
        onApply={applyExpand}
      />
      {sendLocked && sendLockedReason ? (
        <p className="text-center text-xs text-muted-foreground pb-3">{sendLockedReason}</p>
      ) : null}
    </div>
  )
}
