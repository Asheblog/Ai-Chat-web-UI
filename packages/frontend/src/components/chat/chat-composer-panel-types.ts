import type { ChangeEvent, ClipboardEventHandler, KeyboardEventHandler, MutableRefObject } from 'react'
import type { ChatComposerImage, WorkspaceFile } from '@/hooks/use-chat-composer'
import type { McpToolView, McpConnectionOption } from '@/hooks/use-mcp-session-bindings'
import type { KnowledgeBaseItem } from './knowledge-base-selector'
import type { ComposerSkillOption } from './composer-types'
import type { ComposerModelControlProps } from './composer-model-actions'

export interface ChatComposerPanelProps extends ComposerModelControlProps {
  input: string
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>
  /** 768px 以上由桌面 composer 持有共享 ref；SSR 默认移动端。 */
  isDesktopComposer?: boolean
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
  effort: 'low' | 'medium' | 'high' | 'max' | 'xhigh' | 'unset'
  basePlaceholder: string
  mobilePlaceholder: string
  textareaDisabled: boolean
  desktopSendDisabled: boolean
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
  onEffortChange: (value: 'low' | 'medium' | 'high' | 'max' | 'xhigh' | 'unset') => void
  // 统一附件上传
  attachmentInputRef: MutableRefObject<HTMLInputElement | null>
  pickAttachments: () => void
  onAttachmentsSelected: (event: ChangeEvent<HTMLInputElement>) => void
  workspaceFiles: WorkspaceFile[]
  isUploadingWorkspaceFiles: boolean
  hasWorkspaceFiles: boolean
  onRemoveWorkspaceFile: (fileId: string) => void
  // 自定义请求
  customHeaders: Array<{ name: string; value: string }>
  onAddCustomHeader: () => void
  onCustomHeaderChange: (index: number, field: 'name' | 'value', value: string) => void
  onRemoveCustomHeader: (index: number) => void
  canAddCustomHeader: boolean
  customBody: string
  onCustomBodyChange: (value: string) => void
  customBodyError?: string | null
  // 会话提示词
  sessionPromptDraft: string
  sessionPromptSourceLabel: string
  sessionPromptPlaceholder: string
  onSessionPromptChange: (value: string) => void
  onSessionPromptSave: () => void
  sessionPromptSaving: boolean
  // 拖拽上传
  isDragOver?: boolean
  dragHandlers?: {
    onDragEnter: (e: React.DragEvent) => void
    onDragOver: (e: React.DragEvent) => void
    onDragLeave: (e: React.DragEvent) => void
    onDrop: (e: React.DragEvent) => void
  }
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
