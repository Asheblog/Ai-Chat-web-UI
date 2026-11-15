'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BookOpen, Check, ChevronLeft, Clock3, FileText, Globe2, Settings2, Wrench, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import {
  ComposerToolsTrigger,
  WEB_SEARCH_SCOPE_OPTIONS,
  formatWebSearchScopeLabel,
} from './composer-toolbar-primitives'
import {
  ComposerActionRow,
  ComposerCapabilityRow,
  ComposerToolsDivider,
  ComposerToolsSectionLabel,
  ComposerToolsTabs,
  composerToolsRowClass,
} from './composer-tools-panel-rows'

export type ComposerToolsPanelTab = 'capabilities' | 'context'
/** search-scope 是能力页内的子视图；联网标签可直接打开它。 */
export type ComposerToolsPanelView = ComposerToolsPanelTab | 'search-scope'

export interface ComposerToolsPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 手机底部面板；不传时按 768px 断点判断。 */
  mobile?: boolean
  /** 自定义触发器；不传时使用默认“工具”按钮。 */
  trigger?: ReactNode
  /** 未受控时每次打开进入的分组。 */
  initialView?: ComposerToolsPanelView
  /** 受控视图：标签可直达能力页或搜索范围。 */
  view?: ComposerToolsPanelView
  onViewChange?: (view: ComposerToolsPanelView) => void
  /** 面板打开时触发，供上层按需加载 Skill / MCP。 */
  onActivate?: () => void
  /** 生成中或编辑锁定：所有开关与入口禁用。 */
  disabled?: boolean

  // 能力：沿用既有值、回调与可用条件
  thinkingEnabled: boolean
  onToggleThinking: (value: boolean) => void
  webSearchEnabled: boolean
  onToggleWebSearch: (value: boolean) => void
  canUseWebSearch: boolean
  webSearchDisabledNote?: string
  webSearchScope?: string
  showWebSearchScope?: boolean
  onWebSearchScopeChange?: (value: string) => void
  deepResearchEnabled: boolean
  onToggleDeepResearch: (value: boolean) => void
  pythonToolEnabled: boolean
  onTogglePythonTool: (value: boolean) => void
  canUsePythonTool: boolean
  pythonToolDisabledNote?: string

  // 上下文与设置：沿用既有上下文动作
  knowledgeBaseEnabled?: boolean
  knowledgeBaseCount?: number
  onOpenKnowledgeBase?: () => void
  onOpenSkillPanel?: () => void
  skillCount?: number
  onOpenSessionPrompt?: () => void
  onOpenAdvanced?: () => void
  traceEnabled?: boolean
  canUseTrace?: boolean
  onToggleTrace?: (value: boolean) => void
}

function useIsDesktopViewport(enableQuery: boolean) {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (!enableQuery) return true
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia('(min-width: 768px)').matches
  })
  useEffect(() => {
    if (!enableQuery) return
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(min-width: 768px)')
    const update = () => setIsDesktop(query.matches)
    update()
    const handle = (event: MediaQueryListEvent) => setIsDesktop(event.matches)
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', handle)
      return () => query.removeEventListener('change', handle)
    }
    query.addListener(handle)
    return () => query.removeListener(handle)
  }, [enableQuery])
  return isDesktop
}

const closeButtonClass =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] text-ink-tertiary transition-colors duration-[160ms] hover:bg-surface-hover hover:text-foreground md:h-8 md:w-8'

export function ComposerToolsPanel(props: ComposerToolsPanelProps) {
  const {
    open, onOpenChange, mobile, trigger, initialView, view, onViewChange, onActivate, disabled,
    thinkingEnabled, onToggleThinking,
    webSearchEnabled, onToggleWebSearch, canUseWebSearch, webSearchDisabledNote,
    webSearchScope, showWebSearchScope, onWebSearchScopeChange,
    deepResearchEnabled, onToggleDeepResearch,
    pythonToolEnabled, onTogglePythonTool, canUsePythonTool, pythonToolDisabledNote,
    knowledgeBaseEnabled, knowledgeBaseCount, onOpenKnowledgeBase,
    onOpenSkillPanel, skillCount, onOpenSessionPrompt, onOpenAdvanced,
    traceEnabled, canUseTrace, onToggleTrace,
  } = props

  const isDesktopViewport = useIsDesktopViewport(mobile === undefined)
  const isMobile = mobile ?? !isDesktopViewport
  const [internalView, setInternalView] = useState<ComposerToolsPanelView>(initialView ?? 'capabilities')
  const currentView = view ?? internalView

  const onActivateRef = useRef(onActivate)
  onActivateRef.current = onActivate
  useEffect(() => {
    if (open) onActivateRef.current?.()
  }, [open])
  useEffect(() => {
    if (open && view === undefined) setInternalView(initialView ?? 'capabilities')
  }, [open, view, initialView])

  const setView = (next: ComposerToolsPanelView) => {
    if (view === undefined) setInternalView(next)
    onViewChange?.(next)
  }

  const showScopeEntry = Boolean(webSearchEnabled && canUseWebSearch && showWebSearchScope && onWebSearchScopeChange)

  const capabilitiesSection = (
    <div className="space-y-0.5" aria-label="能力">
      <ComposerCapabilityRow id="thinking" checked={thinkingEnabled} disabled={disabled} onToggle={onToggleThinking} />
      <ComposerCapabilityRow
        id="web-search"
        checked={webSearchEnabled}
        disabled={disabled || !canUseWebSearch}
        note={canUseWebSearch ? undefined : webSearchDisabledNote}
        onToggle={onToggleWebSearch}
      />
      {showScopeEntry ? (
        <ComposerActionRow
          icon={<Globe2 className="h-[18px] w-[18px]" />}
          label="搜索范围"
          description="联网搜索的检索范围"
          trailing={formatWebSearchScopeLabel(webSearchScope)}
          disabled={disabled}
          onClick={() => setView('search-scope')}
        />
      ) : null}
      <ComposerCapabilityRow
        id="deep-research"
        checked={deepResearchEnabled}
        disabled={disabled}
        onToggle={onToggleDeepResearch}
      />
      <ComposerCapabilityRow
        id="python"
        checked={pythonToolEnabled}
        disabled={disabled || !canUsePythonTool}
        note={canUsePythonTool ? undefined : pythonToolDisabledNote}
        onToggle={onTogglePythonTool}
      />
    </div>
  )

  const contextSection = (
    <div className="space-y-0.5" aria-label="上下文与设置">
      <ComposerActionRow
        icon={<BookOpen className="h-[18px] w-[18px]" />}
        label="知识库"
        description="选择对话引用的资料"
        trailing={knowledgeBaseCount ? `已选 ${knowledgeBaseCount} 个` : undefined}
        disabled={disabled || knowledgeBaseEnabled === false || !onOpenKnowledgeBase}
        onClick={onOpenKnowledgeBase}
      />
      {onOpenSkillPanel ? (
        <ComposerActionRow
          icon={<Wrench className="h-[18px] w-[18px]" />}
          label="第三方技能与 MCP"
          description="管理已安装的能力"
          trailing={skillCount ? `${skillCount} 个已启用` : undefined}
          disabled={disabled}
          onClick={onOpenSkillPanel}
        />
      ) : null}
      {onOpenSessionPrompt ? (
        <ComposerActionRow
          icon={<FileText className="h-[18px] w-[18px]" />}
          label="会话系统提示词"
          description="查看或修改会话级系统提示词"
          disabled={disabled}
          onClick={onOpenSessionPrompt}
        />
      ) : null}
      {onOpenAdvanced ? (
        <ComposerActionRow
          icon={<Settings2 className="h-[18px] w-[18px]" />}
          label="自定义请求头"
          description="为当前请求附加高级参数"
          disabled={disabled}
          onClick={onOpenAdvanced}
        />
      ) : null}
      {canUseTrace && onToggleTrace ? (
        <>
          <ComposerToolsDivider />
          <div className={cn(composerToolsRowClass, 'justify-between')} data-composer-tools-row>
            <span className="flex min-w-0 items-center gap-3">
              <Clock3 className="h-[18px] w-[18px] shrink-0 text-ink-tertiary" aria-hidden="true" />
              <span className="text-[13px] font-medium leading-5 text-foreground">任务追踪</span>
            </span>
            <Switch
              checked={Boolean(traceEnabled)}
              disabled={disabled}
              onCheckedChange={(value) => onToggleTrace(Boolean(value))}
              aria-label="任务追踪"
            />
          </div>
        </>
      ) : null}
    </div>
  )

  const scopeSection = (
    <div role="radiogroup" aria-label="搜索范围" className="space-y-0.5">
      {WEB_SEARCH_SCOPE_OPTIONS.map((option) => {
        const selected = option.value === (webSearchScope ?? 'webpage')
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => {
              onWebSearchScopeChange?.(option.value)
              setView('capabilities')
            }}
            className={cn(
              composerToolsRowClass,
              'justify-between transition-colors duration-[160ms] hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-45',
              selected ? 'text-signal-text' : 'text-foreground',
            )}
          >
            <span className="text-[13px] leading-5">{option.label}</span>
            {selected ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
          </button>
        )
      })}
    </div>
  )

  const scopeHeader = (
    <div className="flex items-center gap-1.5 px-0.5 pb-1">
      <button type="button" onClick={() => setView('capabilities')} aria-label="返回能力" className={closeButtonClass}>
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      <p className="text-[13px] font-medium text-foreground">搜索范围</p>
    </div>
  )

  const panelHeader = (
    <div className="flex items-center justify-between gap-2 px-0.5">
      <p className="text-[13px] font-semibold text-foreground">工具</p>
      <button type="button" onClick={() => onOpenChange(false)} aria-label="关闭工具面板" className={closeButtonClass}>
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )

  const renderBody = () => {
    if (currentView === 'search-scope') {
      return (
        <div id="composer-tools-panel-search-scope" role="region" aria-label="搜索范围设置">
          {scopeHeader}
          {scopeSection}
        </div>
      )
    }
    if (currentView === 'context') {
      return (
        <div id="composer-tools-panel-context" role="tabpanel" aria-label="上下文与设置">
          {contextSection}
        </div>
      )
    }
    return (
      <div id="composer-tools-panel-capabilities" role="tabpanel" aria-label="能力">
        {capabilitiesSection}
      </div>
    )
  }

  const activeTab: ComposerToolsPanelTab = currentView === 'context' ? 'context' : 'capabilities'
  const defaultTrigger = <ComposerToolsTrigger expanded={open} />

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetTrigger asChild>{trigger ?? defaultTrigger}</SheetTrigger>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          dialogTitle="工具"
          dialogDescription="当前会话的能力开关与上下文设置。"
          className="flex h-[70vh] flex-col rounded-t-3xl border-x-0 border-b-0 border-border bg-surface p-0"
        >
          <div className="shrink-0 border-b border-border px-4 pb-2 pt-3">
            {panelHeader}
            <ComposerToolsTabs value={activeTab} onChange={setView} />
          </div>
          <div
            data-composer-tools-scroll="true"
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2"
          >
            {renderBody()}
          </div>
          <div className="shrink-0 border-t border-border px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex h-11 w-full items-center justify-center rounded-[10px] bg-foreground text-[13px] font-medium text-background transition-colors duration-[160ms] hover:bg-foreground/90"
            >
              完成
            </button>
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger ?? defaultTrigger}</PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-[27rem] max-w-[calc(100vw-2rem)] rounded-xl border-border bg-surface p-2"
      >
        {currentView === 'search-scope' ? (
          <>
            {scopeHeader}
            {scopeSection}
          </>
        ) : (
          <>
            {panelHeader}
            <ComposerToolsDivider />
            <ComposerToolsSectionLabel>能力</ComposerToolsSectionLabel>
            {capabilitiesSection}
            <ComposerToolsDivider />
            <ComposerToolsSectionLabel>上下文与设置</ComposerToolsSectionLabel>
            {contextSection}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
