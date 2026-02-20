import { ChangeEvent, ClipboardEvent, KeyboardEvent, RefObject, useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Maximize2 } from 'lucide-react'
import { CustomRequestEditor } from '@/components/chat/custom-request-editor'
import { AdvancedOptions } from './AdvancedOptions'
import { ImagePreviewList } from './ImagePreviewList'
import { AttachmentMenu } from '@/components/chat/attachment-menu'
import { AttachmentTray, DocumentAttachmentInput } from '@/features/chat/composer'
import type { AttachedDocument } from '@/features/chat/composer/use-document-attachments'
import { KnowledgeBaseSelector, type KnowledgeBaseItem } from '@/components/chat/knowledge-base-selector'

type Effort = 'unset' | 'low' | 'medium' | 'high'

interface WelcomeFormProps {
  form: {
    query: string
    isComposing: boolean
    setIsComposing: (value: boolean) => void
    textareaRef: RefObject<HTMLTextAreaElement>
    basePlaceholder: string
    creationDisabled: boolean
    isCreating: boolean
    showExpand: boolean
    onTextareaChange: (value: string) => void
    onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
    onSubmit: () => void
    onOpenExpand: () => void
    expand: {
      open: boolean
      draft: string
      onChange: (value: string) => void
      onClose: () => void
      onApply: () => void
    }
    attachments: {
      selectedImages: Array<{ dataUrl: string; mime: string; size: number }>
      fileInputRef: RefObject<HTMLInputElement>
      onRemoveImage: (index: number) => void
      onFilesSelected: (event: ChangeEvent<HTMLInputElement>) => void
      onPickImages: () => void
      onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void
      documents: AttachedDocument[]
      onRemoveDocument: (id: number) => void
      onCancelDocument: (id: number) => void
      onPickDocuments: () => void
      onDocumentFilesSelected: (event: ChangeEvent<HTMLInputElement>) => void
      documentInputRef: RefObject<HTMLInputElement>
    }
    knowledgeBase: {
      enabled: boolean
      availableKbs: KnowledgeBaseItem[]
      selectedKbIds: number[]
      isLoading: boolean
      error: string | null
      onToggle: (id: number) => void
      onSelectAll: () => void
      onClearAll: () => void
      onRefresh: () => Promise<void>
      selectorOpen: boolean
      onOpenSelector: () => void
      onSelectorOpenChange: (open: boolean) => void
    }
    advancedOptions: {
      disabled: boolean
      thinkingEnabled: boolean
      onToggleThinking: (value: boolean) => void
      effort: Effort
      onEffortChange: (value: Effort) => void
      webSearchEnabled: boolean
      onToggleWebSearch: (value: boolean) => void
      canUseWebSearch: boolean
      showWebSearchScope: boolean
      webSearchScope: string
      onWebSearchScopeChange: (value: string) => void
      webSearchDisabledNote?: string
      pythonToolEnabled: boolean
      onTogglePythonTool: (value: boolean) => void
      canUsePythonTool: boolean
      pythonToolDisabledNote?: string
      onOpenAdvanced: () => void
      onOpenSessionPrompt: () => void
    }
    advancedDialog: {
      open: boolean
      onClose: () => void
      customHeaders: Array<{ name: string; value: string }>
      onAddHeader: () => void
      onHeaderChange: (index: number, field: 'name' | 'value', value: string) => void
      onRemoveHeader: (index: number) => void
      canAddHeader: boolean
      customBodyInput: string
      onCustomBodyChange: (value: string) => void
      customBodyError: string | null
    }
    sessionPromptDialog: {
      open: boolean
      value: string
      onChange: (value: string) => void
      onClose: () => void
      onConfirm: () => void
      onClear: () => void
      placeholder: string
    }
  }
}

export function WelcomeForm({ form }: WelcomeFormProps) {
  const [attachmentViewerOpen, setAttachmentViewerOpen] = useState(false)
  const {
    query,
    isComposing,
    setIsComposing,
    textareaRef,
    basePlaceholder,
    creationDisabled,
    showExpand,
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

  return (
    <div className="w-full max-w-3xl">
      <div className="flex min-h-14 items-center gap-2 rounded-[1.6rem] border border-border/80 bg-[hsl(var(--background-alt))/0.9] px-3 py-2 shadow-[0_18px_42px_hsl(var(--background)/0.22)] transition focus-within:border-primary/70 focus-within:ring-2 focus-within:ring-ring/60 sm:px-4">
        <AdvancedOptions {...advancedOptions} />
        <div className="flex-1">
          <Textarea
            ref={textareaRef}
            value={query}
            placeholder={basePlaceholder}
            disabled={creationDisabled}
            onChange={(event) => onTextareaChange(event.target.value)}
            onKeyDown={onKeyDown}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onPaste={attachments.onPaste}
            className="h-auto min-h-[40px] resize-none border-0 bg-transparent px-3 py-2 text-left leading-[1.4] placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 sm:px-4"
            rows={1}
          />
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          {showExpand && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-full border border-border/70 bg-[hsl(var(--surface))/0.45] hover:bg-[hsl(var(--surface-hover))]"
              onClick={onOpenExpand}
              disabled={creationDisabled}
              aria-label="全屏编辑"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          )}
          <AttachmentMenu
            onPickImages={attachments.onPickImages}
            onPickDocuments={attachments.onPickDocuments}
            disableImages={creationDisabled}
            disableDocuments={creationDisabled}
            hasImages={attachments.selectedImages.length > 0}
            hasDocuments={attachments.documents.length > 0}
            className="h-10 w-10"
            ariaLabel="添加附件"
            onOpenManager={() => setAttachmentViewerOpen(true)}
            manageDisabled={attachments.selectedImages.length + attachments.documents.length === 0}
            manageCount={attachments.selectedImages.length + attachments.documents.length}
            onOpenKnowledgeBase={knowledgeBase.onOpenSelector}
            knowledgeBaseEnabled={knowledgeBase.enabled}
            knowledgeBaseCount={knowledgeBase.selectedKbIds.length}
          />
        </div>
      </div>

      <ImagePreviewList images={attachments.selectedImages} onRemove={attachments.onRemoveImage} />
      <input
        ref={attachments.fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={attachments.onFilesSelected}
        disabled={creationDisabled}
      />
      {attachmentViewerOpen && (
        <AttachmentTray
          documents={attachments.documents}
          onRemove={attachments.onRemoveDocument}
          onCancel={attachments.onCancelDocument}
          open={attachmentViewerOpen}
          onOpenChange={setAttachmentViewerOpen}
        />
      )}
      <DocumentAttachmentInput inputRef={attachments.documentInputRef} onFilesSelected={attachments.onDocumentFilesSelected} />

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

      <Dialog open={expand.open} onOpenChange={(open) => (open ? onOpenExpand() : expand.onClose())}>
        <DialogContent className="max-w-[1000px] w-[92vw] h-[80vh] max-h-[85vh] p-0 sm:rounded-2xl overflow-hidden flex flex-col">
          <DialogHeader className="sr-only">
            <DialogTitle>编辑消息</DialogTitle>
            <DialogDescription>在全屏编辑器中修改当前草稿内容</DialogDescription>
          </DialogHeader>
          <div className="p-4 border-b text-sm text-muted-foreground">编辑消息</div>
          <div className="flex-1 min-h-0 p-4">
            <Textarea
              value={expand.draft}
              onChange={(event) => expand.onChange(event.target.value)}
              className="h-full w-full resize-none border rounded-md p-3"
            />
          </div>
          <div className="p-4 border-t flex justify-end gap-2">
            <Button variant="outline" onClick={expand.onClose}>
              取消
            </Button>
            <Button onClick={expand.onApply}>应用</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={advancedDialog.open} onOpenChange={(open) => (!open ? advancedDialog.onClose() : null)}>
        <DialogContent className="max-w-3xl w-full max-h-[85vh] overflow-hidden p-0 sm:rounded-2xl">
          <DialogHeader className="px-5 py-4 border-b">
            <DialogTitle>高级请求定制</DialogTitle>
            <DialogDescription>
              为本次消息添加自定义请求体和请求头。核心字段已锁定，敏感头会被忽略。
            </DialogDescription>
          </DialogHeader>
          <div className="px-5 py-4">
            <CustomRequestEditor
              customHeaders={advancedDialog.customHeaders}
              onAddHeader={advancedDialog.onAddHeader}
              onHeaderChange={advancedDialog.onHeaderChange}
              onRemoveHeader={advancedDialog.onRemoveHeader}
              canAddHeader={advancedDialog.canAddHeader}
              customBody={advancedDialog.customBodyInput}
              onCustomBodyChange={advancedDialog.onCustomBodyChange}
              customBodyError={advancedDialog.customBodyError}
            />
          </div>
          <div className="flex justify-end border-t px-5 py-3">
            <Button variant="secondary" onClick={advancedDialog.onClose}>
              完成
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={sessionPromptDialog.open} onOpenChange={(open) => (!open ? sessionPromptDialog.onClose() : null)}>
        <DialogContent className="max-w-2xl w-full max-h-[80vh] overflow-hidden p-0 sm:rounded-2xl">
          <DialogHeader className="px-5 py-4 border-b">
            <DialogTitle>会话系统提示词</DialogTitle>
            <DialogDescription>
              {sessionPromptDialog.value.trim()
                ? '当前会话将使用该提示词'
                : sessionPromptDialog.placeholder || '留空继承上级或使用默认提示词'}
            </DialogDescription>
          </DialogHeader>
          <div className="px-5 py-4 space-y-3">
            <textarea
              value={sessionPromptDialog.value}
              onChange={(event) => sessionPromptDialog.onChange(event.target.value)}
              rows={6}
              placeholder={sessionPromptDialog.placeholder}
              className="w-full rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-sm leading-relaxed focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
            <p className="text-xs text-muted-foreground">
              {'生效顺序：会话 > 个人 > 全局；支持 {day time}（自动替换为服务器当前时间）。留空继承上级，三层均为空时默认使用“今天日期是{day time}”。'}
            </p>
          </div>
          <div className="flex items-center justify-between border-t px-5 py-3">
            <Button variant="ghost" onClick={sessionPromptDialog.onClear}>
              清空
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={sessionPromptDialog.onClose}>
                取消
              </Button>
              <Button onClick={sessionPromptDialog.onConfirm}>确认</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
