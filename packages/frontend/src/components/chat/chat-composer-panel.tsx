'use client'

import { type ChangeEvent, type KeyboardEventHandler, type MutableRefObject, useState } from 'react'
import type { ChatComposerImage } from '@/hooks/use-chat-composer'
import { MobileComposer } from './mobile-composer'
import { DesktopComposer } from './desktop-composer'
import { ExpandEditorDialog } from './expand-editor-dialog'

interface ImageLimitConfig {
  maxCount: number
  maxMb: number
  maxEdge: number
}

interface ChatComposerPanelProps {
  input: string
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>
  showExpand: boolean
  isStreaming: boolean
  selectedImages: ChatComposerImage[]
  thinkingEnabled: boolean
  webSearchEnabled: boolean
  canUseWebSearch: boolean
  isVisionEnabled: boolean
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
  onEffortChange: (value: 'low' | 'medium' | 'high' | 'unset') => void
  fileInputRef: MutableRefObject<HTMLInputElement | null>
  onFilesSelected: (event: ChangeEvent<HTMLInputElement>) => void
  imageLimits: ImageLimitConfig
}

export function ChatComposerPanel({
  input,
  textareaRef,
  showExpand,
  isStreaming,
  selectedImages,
  thinkingEnabled,
  webSearchEnabled,
  canUseWebSearch,
  isVisionEnabled,
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
  onEffortChange,
  fileInputRef,
  onFilesSelected,
  imageLimits,
}: ChatComposerPanelProps) {
  const [expandOpen, setExpandOpen] = useState(false)
  const [expandDraft, setExpandDraft] = useState('')

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
      <MobileComposer
        input={input}
        textareaRef={textareaRef}
        onInputChange={onInputChange}
        onKeyDown={onKeyDown}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        isStreaming={isStreaming}
        onSend={onSend}
        onStop={onStop}
        selectedImages={selectedImages}
        onRemoveImage={onRemoveImage}
        thinkingEnabled={thinkingEnabled}
        onToggleThinking={onToggleThinking}
        webSearchEnabled={webSearchEnabled}
        onToggleWebSearch={onToggleWebSearch}
        pickImages={pickImages}
        canUseWebSearch={canUseWebSearch}
        isVisionEnabled={isVisionEnabled}
        placeholder={mobilePlaceholder}
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
        canUseWebSearch={canUseWebSearch}
        effort={effort}
        onEffortChange={onEffortChange}
        showExpand={showExpand}
        onExpandOpen={openExpand}
        onSend={onSend}
        onStop={onStop}
        desktopSendDisabled={desktopSendDisabled}
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
    </div>
  )
}
