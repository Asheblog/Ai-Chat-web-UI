import React, { ChangeEvent, ClipboardEvent, KeyboardEvent, RefObject, useEffect, useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, Maximize2, Send } from 'lucide-react'
import { CustomRequestEditor } from '@/components/chat/custom-request-editor'
import { AdvancedOptions } from './AdvancedOptions'
import { ComposerAttachmentList } from '@/components/chat/composer-attachment-list'
import { AttachmentUploadButton } from '@/components/chat/attachment-upload-button'
import type { WorkspaceFile } from '@/features/chat/composer'
import { KnowledgeBaseSelector, type KnowledgeBaseItem } from '@/components/chat/knowledge-base-selector'
import { cn } from '@/lib/utils'
import { COMPOSER_TEXTAREA_BASE_CLASS } from '@/components/chat/composer-shell-styles'
import { ComposerShell } from '@/components/chat/composer-shell'
import {
  ComposerFeatureControls,
  ComposerIconButton,
  composerToolbarButtonClass,
  composerToolbarScrollClass,
} from '@/components/chat/composer-toolbar-primitives'

type Effort = 'unset' | 'low' | 'medium' | 'high' | 'max' | 'xhigh'

interface WelcomeFormProps {
  form: {
    query: string
    isComposing: boolean
    setIsComposing: (value: boolean) => void
    textareaRef: RefObject<HTMLTextAreaElement>
    basePlaceholder: string
    mobilePlaceholder: string
    mobileQuotaNotice: string | null
    creationDisabled: boolean
    isCreating: boolean
    showExpand: boolean
    isDragOver?: boolean
    dragHandlers?: {
      onDragEnter: (e: React.DragEvent) => void
      onDragOver: (e: React.DragEvent) => void
      onDragLeave: (e: React.DragEvent) => void
      onDrop: (e: React.DragEvent) => void
    }
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
      onRemoveImage: (index: number) => void
      onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void
      workspaceFiles: WorkspaceFile[]
      onRemoveWorkspaceFile: (workspacePath: string) => void
      // 统一附件上传
      attachmentInputRef: RefObject<HTMLInputElement>
      pickAttachments: () => void
      onAttachmentsSelected: (event: ChangeEvent<HTMLInputElement>) => void
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
      skillOptions: Array<{
        skillId: number
        versionId: number | null
        slug: string
        label: string
        description?: string
        enabled: boolean
      }>
      onToggleSkillOption: (skillId: number, enabled: boolean) => void
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
  const {
    query,
    isComposing,
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

  return (
    <div
      className="relative w-full max-w-[940px]"
      {...(dragHandlers ?? {})}
    >
      {/* 拖拽上传遮罩 */}
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/50 bg-primary/[0.04] backdrop-blur-[1px]">
          <div className="rounded-xl bg-background/80 px-5 py-3 text-center shadow-sm backdrop-blur-sm">
            <p className="text-sm font-medium text-foreground">松开以上传文件</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">推荐 PDF / Word / Excel / CSV / 文本 / 代码</p>
          </div>
        </div>
      )}
      <ComposerAttachmentList
        images={attachments.selectedImages}
        onRemoveImage={attachments.onRemoveImage}
        workspaceFiles={attachments.workspaceFiles}
        onRemoveWorkspaceFile={attachments.onRemoveWorkspaceFile}
      />

      <ComposerShell>
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
            'min-h-[64px] max-h-[200px] w-full text-sm lg:min-h-[68px]',
            showExpand && 'pr-12',
          )}
          rows={1}
        />

        {showExpand && (
          <ComposerIconButton
            className="absolute right-4 top-4 h-8 w-8 rounded-[7px]"
            onClick={onOpenExpand}
            disabled={creationDisabled}
            aria-label="全屏编辑"
            title="全屏编辑"
          >
            <Maximize2 className="h-4 w-4" />
          </ComposerIconButton>
        )}

        <div className="mt-2 flex items-center justify-between gap-2">
          <div className={cn(composerToolbarScrollClass, 'flex-1')}>
            <AdvancedOptions {...advancedOptions} triggerClassName={composerToolbarButtonClass} />
            <AttachmentUploadButton
              onPick={attachments.pickAttachments}
              disabled={creationDisabled}
              hasAttachments={hasAttachments}
              count={attachmentsCount}
              ariaLabel="上传附件"
              className={composerToolbarButtonClass}
            />

            <ComposerFeatureControls
              disabled={creationDisabled}
              thinkingEnabled={advancedOptions.thinkingEnabled}
              onToggleThinking={advancedOptions.onToggleThinking}
              webSearchEnabled={advancedOptions.webSearchEnabled}
              onToggleWebSearch={advancedOptions.onToggleWebSearch}
              canUseWebSearch={advancedOptions.canUseWebSearch}
              webSearchDisabledNote={advancedOptions.webSearchDisabledNote}
              pythonToolEnabled={advancedOptions.pythonToolEnabled}
              onTogglePythonTool={advancedOptions.onTogglePythonTool}
              canUsePythonTool={advancedOptions.canUsePythonTool}
              pythonToolDisabledNote={advancedOptions.pythonToolDisabledNote}
              knowledgeBaseEnabled={knowledgeBase.enabled}
              knowledgeBaseCount={knowledgeBase.selectedKbIds.length}
              onOpenKnowledgeBase={knowledgeBase.onOpenSelector}
            />
          </div>

          <Button
            type="button"
            onClick={onSubmit}
            disabled={creationDisabled}
            className="h-10 w-10 shrink-0 rounded-[10px] p-0 shadow-[0_10px_22px_rgba(37,99,235,0.18)] disabled:shadow-none"
            aria-label={isCreating ? '正在创建会话' : '发送'}
          >
            {isCreating ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Send className="h-[18px] w-[18px]" />}
          </Button>
        </div>
      </ComposerShell>

      {mobileQuotaNotice ? (
        <p className="mx-auto mt-3 max-w-3xl rounded-full border border-border/70 bg-[hsl(var(--surface))/0.65] px-3 py-1.5 text-center text-xs text-muted-foreground backdrop-blur-sm md:hidden">
          {mobileQuotaNotice}
        </p>
      ) : null}

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
              {'生效顺序：会话 > 个人 > 全局；支持 {day time}（自动替换为服务器当前时间）。留空继承上级，三层均为空时默认使用"今天日期是{day time}"。'}
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
