import type React from 'react'
import type { ChangeEvent, ClipboardEvent, KeyboardEvent, RefObject } from 'react'
import type { WorkspaceFile } from '@/features/chat/composer'
import type { KnowledgeBaseItem } from '@/components/chat/knowledge-base-selector'
import type { ComposerModelControlProps } from '@/components/chat/composer-model-actions'

type Effort = 'unset' | 'low' | 'medium' | 'high' | 'max' | 'xhigh'

export interface WelcomeFormProps extends ComposerModelControlProps {
  modelDisabled?: boolean
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
      deepResearchEnabled: boolean
      onToggleDeepResearch: (value: boolean) => void
      skillOptions: Array<{
        skillId: number
        versionId: number | null
        slug: string
        label: string
        description?: string
        enabled: boolean
      }>
      onToggleSkillOption: (skillId: number, enabled: boolean) => void
      onActivateSkillPanel?: () => void
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
