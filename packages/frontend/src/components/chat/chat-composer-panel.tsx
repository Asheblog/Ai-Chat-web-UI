'use client'

import { type ChangeEvent, type KeyboardEventHandler, type MutableRefObject, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ChatComposerImage } from '@/hooks/use-chat-composer'
import { MobileComposer } from './mobile-composer'
import { DesktopComposer } from './desktop-composer'
import { ExpandEditorDialog } from './expand-editor-dialog'
import { CustomRequestEditor } from './custom-request-editor'
import { Button } from '@/components/ui/button'

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
  customBody: string
  onCustomBodyChange: (value: string) => void
  customBodyError?: string | null
  sessionPromptDraft: string
  sessionPromptSourceLabel: string
  sessionPromptPlaceholder: string
  onSessionPromptChange: (value: string) => void
  onSessionPromptSave: () => void
  sessionPromptSaving: boolean
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
  customBody,
  onCustomBodyChange,
  customBodyError,
  sessionPromptDraft,
  sessionPromptSaving,
  sessionPromptSourceLabel,
  sessionPromptPlaceholder,
  onSessionPromptChange,
  onSessionPromptSave,
}: ChatComposerPanelProps) {
  const portalRoot = useMemo(() => (typeof document !== 'undefined' ? document.body : null), [])
  const [expandOpen, setExpandOpen] = useState(false)
  const [expandDraft, setExpandDraft] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [sessionPromptOpen, setSessionPromptOpen] = useState(false)

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
                  <p className="text-xs text-muted-foreground">生效顺序：会话 &gt; 全局。留空则继承全局提示词。</p>
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
        canUseWebSearch={canUseWebSearch}
        isVisionEnabled={isVisionEnabled}
        placeholder={mobilePlaceholder}
        traceEnabled={traceEnabled}
        canUseTrace={canUseTrace}
        onToggleTrace={onToggleTrace}
        onOpenAdvanced={() => setAdvancedOpen(true)}
        onOpenSessionPrompt={() => setSessionPromptOpen(true)}
      />

      <DesktopComposer
        input={input}
        textareaRef={textareaRef}
        onInputChange={onInputChange}
        onKeyDown={onKeyDown}
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
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={onFilesSelected}
        disabled={!isVisionEnabled}
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
