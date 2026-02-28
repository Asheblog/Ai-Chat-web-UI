'use client'

import {
  type ChangeEvent,
  type ClipboardEventHandler,
  type KeyboardEventHandler,
  type MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import type { ChatComposerImage, AttachedDocument } from '@/hooks/use-chat-composer'
import { MobileComposer } from './mobile-composer'
import { DesktopComposer } from './desktop-composer'
import { ExpandEditorDialog } from './expand-editor-dialog'
import { CustomRequestEditor } from './custom-request-editor'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { AttachmentTray, DocumentAttachmentInput } from '@/features/chat/composer'
import {
  createPromptTemplate,
  deletePromptTemplate,
  listPromptTemplates,
  updatePromptTemplate,
} from '@/features/prompt-templates/api'
import { KnowledgeBaseSelector, type KnowledgeBaseItem } from './knowledge-base-selector'
import type { PromptTemplate } from '@/types'

interface ImageLimitConfig {
  maxCount: number
  maxMb: number
  maxEdge: number
  maxTotalMb: number
}

export interface ComposerSkillOption {
  slug: string
  label: string
  description?: string
  enabled: boolean
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
  skillOptions: ComposerSkillOption[]
  onToggleSkillOption: (slug: string, enabled: boolean) => void
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

const MAX_PROMPT_TEMPLATE_VARIABLES = 20
const MAX_PROMPT_TEMPLATE_VARIABLE_LENGTH = 64

const sortPromptTemplates = (templates: PromptTemplate[]) => {
  return [...templates].sort((a, b) => {
    const aPinned = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0
    const bPinned = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0
    if (aPinned !== bPinned) return bPinned - aPinned
    const aUpdated = new Date(a.updatedAt).getTime()
    const bUpdated = new Date(b.updatedAt).getTime()
    return bUpdated - aUpdated
  })
}

const extractPromptVariables = (content: string): string[] => {
  if (!content) return []
  const unique = new Set<string>()
  const matches = content.match(/\{([^{}]+)\}/g) || []
  for (const token of matches) {
    const variable = token.slice(1, -1).trim()
    if (!variable) continue
    unique.add(variable.slice(0, MAX_PROMPT_TEMPLATE_VARIABLE_LENGTH))
    if (unique.size >= MAX_PROMPT_TEMPLATE_VARIABLES) break
  }
  return Array.from(unique)
}

const deriveTemplateTitle = (content: string): string => {
  const compact = content.replace(/\s+/g, ' ').trim()
  if (!compact) return '未命名模板'
  if (compact.length <= 28) return compact
  return `${compact.slice(0, 28)}...`
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
  skillOptions,
  onToggleSkillOption,
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
  const { toast } = useToast()
  const portalRoot = useMemo(() => (typeof document !== 'undefined' ? document.body : null), [])
  const [expandOpen, setExpandOpen] = useState(false)
  const [expandDraft, setExpandDraft] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [sessionPromptOpen, setSessionPromptOpen] = useState(false)
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([])
  const [promptTemplatesLoading, setPromptTemplatesLoading] = useState(false)
  const [promptTemplatesError, setPromptTemplatesError] = useState<string | null>(null)
  const [promptTemplateSearch, setPromptTemplateSearch] = useState('')
  const [promptTemplateTitle, setPromptTemplateTitle] = useState('')
  const [promptTemplateSaving, setPromptTemplateSaving] = useState(false)
  const [promptTemplateBusyId, setPromptTemplateBusyId] = useState<number | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null)
  const [attachmentViewerOpen, setAttachmentViewerOpen] = useState(false)
  const [kbSelectorOpen, setKbSelectorOpen] = useState(false)
  const attachmentsCount = selectedImages.length + attachedDocuments.length

  const filteredPromptTemplates = useMemo(() => {
    const keyword = promptTemplateSearch.trim().toLowerCase()
    if (!keyword) return promptTemplates
    return promptTemplates.filter((template) => {
      return (
        template.title.toLowerCase().includes(keyword) ||
        template.content.toLowerCase().includes(keyword)
      )
    })
  }, [promptTemplateSearch, promptTemplates])

  const loadPromptTemplates = useCallback(async () => {
    setPromptTemplatesLoading(true)
    setPromptTemplatesError(null)
    try {
      const templates = await listPromptTemplates()
      setPromptTemplates(sortPromptTemplates(templates))
    } catch (error: any) {
      const status = Number(error?.response?.status)
      if (status === 401) {
        setPromptTemplates([])
        setPromptTemplatesError('登录后可使用提示词模板。')
        return
      }
      const message =
        error?.response?.data?.error ||
        error?.message ||
        '加载提示词模板失败'
      setPromptTemplatesError(message)
      setPromptTemplates([])
    } finally {
      setPromptTemplatesLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!sessionPromptOpen) return
    void loadPromptTemplates()
  }, [sessionPromptOpen, loadPromptTemplates])

  const upsertTemplateList = useCallback((next: PromptTemplate) => {
    setPromptTemplates((prev) => {
      const existed = prev.some((item) => item.id === next.id)
      const merged = existed
        ? prev.map((item) => (item.id === next.id ? next : item))
        : [next, ...prev]
      return sortPromptTemplates(merged)
    })
  }, [])

  const handleApplyTemplate = useCallback((template: PromptTemplate) => {
    onSessionPromptChange(template.content)
    setSelectedTemplateId(template.id)
    setPromptTemplateTitle(template.title)
  }, [onSessionPromptChange])

  const handleCreateTemplate = useCallback(async () => {
    const normalizedContent = sessionPromptDraft.trim()
    if (!normalizedContent) {
      toast({
        title: '无法保存模板',
        description: '请先输入提示词内容。',
        variant: 'destructive',
      })
      return
    }
    const normalizedTitle = promptTemplateTitle.trim() || deriveTemplateTitle(normalizedContent)
    setPromptTemplateSaving(true)
    try {
      const created = await createPromptTemplate({
        title: normalizedTitle,
        content: normalizedContent,
        variables: extractPromptVariables(normalizedContent),
      })
      upsertTemplateList(created)
      setSelectedTemplateId(created.id)
      setPromptTemplateTitle(created.title)
      toast({ title: '模板已保存' })
    } catch (error: any) {
      toast({
        title: '保存模板失败',
        description: error?.response?.data?.error || error?.message || '请稍后重试',
        variant: 'destructive',
      })
    } finally {
      setPromptTemplateSaving(false)
    }
  }, [promptTemplateTitle, sessionPromptDraft, toast, upsertTemplateList])

  const handleUpdateTemplate = useCallback(async () => {
    if (!selectedTemplateId) {
      toast({
        title: '请选择模板',
        description: '先从左侧选择一个模板，再执行更新。',
        variant: 'destructive',
      })
      return
    }
    const normalizedContent = sessionPromptDraft.trim()
    if (!normalizedContent) {
      toast({
        title: '无法更新模板',
        description: '提示词内容不能为空。',
        variant: 'destructive',
      })
      return
    }
    setPromptTemplateSaving(true)
    try {
      const updated = await updatePromptTemplate(selectedTemplateId, {
        title: promptTemplateTitle.trim() || undefined,
        content: normalizedContent,
        variables: extractPromptVariables(normalizedContent),
      })
      upsertTemplateList(updated)
      setPromptTemplateTitle(updated.title)
      toast({ title: '模板已更新' })
    } catch (error: any) {
      toast({
        title: '更新模板失败',
        description: error?.response?.data?.error || error?.message || '请稍后重试',
        variant: 'destructive',
      })
    } finally {
      setPromptTemplateSaving(false)
    }
  }, [promptTemplateTitle, selectedTemplateId, sessionPromptDraft, toast, upsertTemplateList])

  const handleToggleTemplatePin = useCallback(async (template: PromptTemplate) => {
    setPromptTemplateBusyId(template.id)
    try {
      const updated = await updatePromptTemplate(template.id, { pinned: !template.pinnedAt })
      upsertTemplateList(updated)
    } catch (error: any) {
      toast({
        title: '更新置顶状态失败',
        description: error?.response?.data?.error || error?.message || '请稍后重试',
        variant: 'destructive',
      })
    } finally {
      setPromptTemplateBusyId(null)
    }
  }, [toast, upsertTemplateList])

  const handleDeleteTemplate = useCallback(async (template: PromptTemplate) => {
    setPromptTemplateBusyId(template.id)
    try {
      await deletePromptTemplate(template.id)
      setPromptTemplates((prev) => prev.filter((item) => item.id !== template.id))
      if (selectedTemplateId === template.id) {
        setSelectedTemplateId(null)
        setPromptTemplateTitle('')
      }
      toast({ title: '模板已删除' })
    } catch (error: any) {
      toast({
        title: '删除模板失败',
        description: error?.response?.data?.error || error?.message || '请稍后重试',
        variant: 'destructive',
      })
    } finally {
      setPromptTemplateBusyId(null)
    }
  }, [selectedTemplateId, toast])

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
    <div className="sticky bottom-0 w-full bg-[hsl(var(--background-alt))/0.88] backdrop-blur supports-[backdrop-filter]:bg-[hsl(var(--background-alt))/0.72]">
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
              <div className="px-5 py-4">
                <div className="grid gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <input
                        value={promptTemplateSearch}
                        onChange={(event) => setPromptTemplateSearch(event.target.value)}
                        placeholder="搜索模板"
                        className="h-9 w-full rounded-lg border border-border/60 bg-muted/20 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void loadPromptTemplates()}
                        disabled={promptTemplatesLoading}
                      >
                        刷新
                      </Button>
                    </div>
                    <div className="max-h-[320px] overflow-y-auto rounded-xl border border-border/60 bg-muted/20 p-2">
                      {promptTemplatesLoading ? (
                        <div className="px-2 py-3 text-xs text-muted-foreground">正在加载模板...</div>
                      ) : filteredPromptTemplates.length === 0 ? (
                        <div className="px-2 py-3 text-xs text-muted-foreground">暂无模板，可在右侧保存当前内容。</div>
                      ) : (
                        filteredPromptTemplates.map((template) => (
                          <div
                            key={template.id}
                            className={`rounded-lg border px-2.5 py-2 ${
                              selectedTemplateId === template.id
                                ? 'border-primary/50 bg-primary/10'
                                : 'border-border/50 bg-background/70'
                            }`}
                          >
                            <button
                              type="button"
                              className="w-full text-left"
                              onClick={() => handleApplyTemplate(template)}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-sm font-medium">{template.title}</p>
                                {template.pinnedAt ? (
                                  <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">置顶</span>
                                ) : null}
                              </div>
                              <p className="mt-1 max-h-10 overflow-hidden text-xs leading-5 text-muted-foreground">
                                {template.content}
                              </p>
                            </button>
                            <div className="mt-2 flex items-center gap-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => void handleToggleTemplatePin(template)}
                                disabled={promptTemplateBusyId === template.id}
                              >
                                {template.pinnedAt ? '取消置顶' : '置顶'}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                                onClick={() => void handleDeleteTemplate(template)}
                                disabled={promptTemplateBusyId === template.id}
                              >
                                删除
                              </Button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    {promptTemplatesError ? (
                      <p className="text-xs text-muted-foreground">{promptTemplatesError}</p>
                    ) : null}
                  </div>

                  <div className="space-y-3">
                    <textarea
                      value={sessionPromptDraft}
                      onChange={(e) => onSessionPromptChange(e.target.value)}
                      rows={8}
                      placeholder={sessionPromptPlaceholder}
                      className="w-full rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-sm leading-relaxed focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    />
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                      <input
                        value={promptTemplateTitle}
                        onChange={(event) => setPromptTemplateTitle(event.target.value)}
                        placeholder="模板名称（可选）"
                        className="h-9 w-full rounded-lg border border-border/60 bg-muted/20 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      />
                      <Button
                        variant="outline"
                        onClick={() => void handleCreateTemplate()}
                        disabled={promptTemplateSaving}
                      >
                        保存为模板
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => void handleUpdateTemplate()}
                        disabled={promptTemplateSaving || !selectedTemplateId}
                      >
                        更新模板
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {'生效顺序：会话 > 个人 > 全局；支持 {day time}（自动替换为服务器当前时间）。留空继承上级，三层均为空时默认使用“今天日期是{day time}”。'}
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-border/60 px-5 py-3">
                <Button variant="ghost" onClick={() => onSessionPromptChange('')} disabled={sessionPromptSaving}>
                  清空
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setSessionPromptOpen(false)}
                    disabled={sessionPromptSaving || promptTemplateSaving}
                  >
                    取消
                  </Button>
                  <Button
                    onClick={async () => {
                      await onSessionPromptSave()
                      setSessionPromptOpen(false)
                    }}
                    disabled={sessionPromptSaving || promptTemplateSaving}
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
        skillOptions={skillOptions}
        onToggleSkillOption={onToggleSkillOption}
        isVisionEnabled={isVisionEnabled}
        placeholder={mobilePlaceholder}
        traceEnabled={traceEnabled}
        canUseTrace={canUseTrace}
        onToggleTrace={onToggleTrace}
        onOpenAdvanced={() => setAdvancedOpen(true)}
        onOpenSessionPrompt={() => setSessionPromptOpen(true)}
        onOpenAttachmentManager={() => setAttachmentViewerOpen(true)}
        attachmentsCount={attachmentsCount}
        // 知识库
        onOpenKnowledgeBase={() => setKbSelectorOpen(true)}
        knowledgeBaseEnabled={knowledgeBaseEnabled}
        knowledgeBaseCount={selectedKnowledgeBaseIds?.length ?? 0}
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
        skillOptions={skillOptions}
        onToggleSkillOption={onToggleSkillOption}
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
