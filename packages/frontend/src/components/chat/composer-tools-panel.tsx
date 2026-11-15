'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { BookOpen, ChevronLeft, Clock3, FileText, Globe2, Settings2, Wrench, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { useDesktopComposer } from '@/hooks/use-desktop-composer'
import { ComposerToolsTrigger, formatWebSearchScopeLabel } from './composer-toolbar-primitives'
import {
  ComposerActionRow,
  ComposerCapabilityRow,
  ComposerScopeOptions,
  ComposerToggleRow,
  ComposerToolsDivider,
  ComposerToolsSectionLabel,
  ComposerToolsTabs,
  composerToolsPanelId,
  composerToolsTabId,
  type ComposerToolsTabId,
} from './composer-tools-panel-rows'

/**
 * 工具面板收起后，等 Sheet 退出动画结束再打开下一个覆盖层：
 * 仍在退场的 z-50 模态层会拦截新弹层里的点击（375 会话系统提示词的保存按钮曾被它挡住）。
 */
export const COMPOSER_TOOLS_HANDOFF_MS = 220

export type ComposerToolsPanelTab = ComposerToolsTabId
/** search-scope 是能力页内的子视图；联网标签可直接打开它。 */
export type ComposerToolsPanelView = ComposerToolsPanelTab | 'search-scope'

export interface ComposerToolsPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 手机底部面板；不传时按 768px 断点判断。 */
  mobile?: boolean
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

const headerIconButtonClass =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] text-ink-tertiary transition-colors duration-[160ms] hover:bg-surface-hover hover:text-foreground md:h-8 md:w-8'

export function ComposerToolsPanel(props: ComposerToolsPanelProps) {
  const {
    open, onOpenChange, mobile, view, onViewChange, onActivate, disabled,
    thinkingEnabled, onToggleThinking,
    webSearchEnabled, onToggleWebSearch, canUseWebSearch, webSearchDisabledNote,
    webSearchScope, showWebSearchScope, onWebSearchScopeChange,
    deepResearchEnabled, onToggleDeepResearch,
    pythonToolEnabled, onTogglePythonTool, canUsePythonTool, pythonToolDisabledNote,
    knowledgeBaseEnabled, knowledgeBaseCount, onOpenKnowledgeBase,
    onOpenSkillPanel, skillCount, onOpenSessionPrompt, onOpenAdvanced,
    traceEnabled, canUseTrace, onToggleTrace,
  } = props

  // 复用既有断点 hook（SSR 固定移动端、水合后切换），并让双端同时挂载时 id 不冲突。
  const isDesktopViewport = useDesktopComposer()
  const isMobile = mobile ?? !isDesktopViewport
  const idBase = `composer-tools-${useId().replace(/:/g, '')}`

  const [internalView, setInternalView] = useState<ComposerToolsPanelView>('capabilities')
  const requestedView = view ?? internalView
  const scopeAvailable = Boolean(webSearchEnabled && canUseWebSearch && showWebSearchScope && onWebSearchScopeChange)
  // 可用条件对直入的范围页同样生效：不可用时回落到能力页。
  const currentView: ComposerToolsPanelView =
    requestedView === 'search-scope' && !scopeAvailable ? 'capabilities' : requestedView
  const activeTab: ComposerToolsPanelTab = currentView === 'context' ? 'context' : 'capabilities'

  const backRef = useRef<HTMLButtonElement | null>(null)
  const scopeEntryRef = useRef<HTMLButtonElement | null>(null)
  const tabListRef = useRef<HTMLDivElement | null>(null)

  const onActivateRef = useRef(onActivate)
  onActivateRef.current = onActivate
  useEffect(() => {
    if (open) onActivateRef.current?.()
  }, [open])
  useEffect(() => {
    if (open && view === undefined) setInternalView('capabilities')
  }, [open, view])

  // 视图切换后的焦点：进入范围页落到“返回能力”，返回后回到页签或范围入口。
  const previousView = useRef<ComposerToolsPanelView>(currentView)
  useEffect(() => {
    const previous = previousView.current
    previousView.current = currentView
    if (previous === currentView) return
    if (currentView === 'search-scope') {
      backRef.current?.focus()
      return
    }
    if (previous === 'search-scope') {
      const activeTabNode = tabListRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
      ;(activeTabNode ?? scopeEntryRef.current)?.focus()
    }
  }, [currentView])

  const setView = (next: ComposerToolsPanelView) => {
    if (next === 'search-scope' && !scopeAvailable) return
    if (view === undefined) setInternalView(next)
    onViewChange?.(next)
  }

  const showScopeEntry = Boolean(scopeAvailable && showWebSearchScope && onWebSearchScopeChange)

  const capabilitiesSection = (
    <div role="group" aria-label="能力" className="space-y-0.5">
      <ComposerCapabilityRow id="thinking" checked={thinkingEnabled} disabled={disabled} onToggle={onToggleThinking} />
      <ComposerCapabilityRow
        id="web-search"
        // 勾选表示“本次会生效”：权限缺失时即使 store 偏好为开也显示未勾选，避免显示勾选却不生效。
        checked={webSearchEnabled && canUseWebSearch}
        disabled={disabled || !canUseWebSearch}
        note={canUseWebSearch ? undefined : webSearchDisabledNote}
        onToggle={onToggleWebSearch}
      />
      {showScopeEntry ? (
        <ComposerActionRow
          buttonRef={scopeEntryRef}
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
        checked={pythonToolEnabled && canUsePythonTool}
        disabled={disabled || !canUsePythonTool}
        note={canUsePythonTool ? undefined : pythonToolDisabledNote}
        onToggle={onTogglePythonTool}
      />
    </div>
  )

  const contextSection = (
    <div role="group" aria-label="上下文与设置" className="space-y-0.5">
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
          <ComposerToggleRow
            icon={<Clock3 className="h-[18px] w-[18px]" />}
            label="任务追踪"
            checked={Boolean(traceEnabled)}
            disabled={disabled}
            onToggle={onToggleTrace}
          />
        </>
      ) : null}
    </div>
  )

  const scopeSection = (
    <ComposerScopeOptions
      value={webSearchScope}
      disabled={disabled}
      onSelect={(value) => {
        onWebSearchScopeChange?.(value)
        setView('capabilities')
      }}
    />
  )

  const closeButton = (
    <button type="button" onClick={() => onOpenChange(false)} aria-label="关闭工具面板" className={headerIconButtonClass}>
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  )

  const panelHeader = (
    <div className="flex shrink-0 items-center justify-between gap-2 px-0.5">
      <p className="text-[13px] font-semibold text-foreground">工具</p>
      {closeButton}
    </div>
  )

  const scopeHeader = (
    <div className="flex shrink-0 items-center gap-1.5 px-0.5">
      <button
        ref={backRef}
        type="button"
        onClick={() => setView('capabilities')}
        aria-label="返回能力"
        className={headerIconButtonClass}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">搜索范围</p>
      {closeButton}
    </div>
  )

  const scopeBody = (
    <div role="region" aria-label="搜索范围设置" className="space-y-0.5">
      {scopeSection}
    </div>
  )

  const desktopSections = (
    <>
      <ComposerToolsDivider />
      <ComposerToolsSectionLabel>能力</ComposerToolsSectionLabel>
      {capabilitiesSection}
      <ComposerToolsDivider />
      <ComposerToolsSectionLabel>上下文与设置</ComposerToolsSectionLabel>
      {contextSection}
    </>
  )

  const defaultTrigger = <ComposerToolsTrigger expanded={open} />

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetTrigger asChild>{defaultTrigger}</SheetTrigger>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          dialogTitle="工具"
          dialogDescription="当前会话的能力开关与上下文设置。"
          className="flex h-[min(70vh,calc(var(--app-visible-height,100dvh)*0.9))] flex-col rounded-t-3xl border-x-0 border-b-0 border-border bg-surface p-0"
          style={{ bottom: 'var(--app-keyboard-inset, 0px)' }}
        >
          <div className="shrink-0 border-b border-border px-4 pb-2 pt-3">
            {currentView === 'search-scope' ? (
              scopeHeader
            ) : (
              <>
                {panelHeader}
                <ComposerToolsTabs idBase={idBase} value={activeTab} onChange={setView} listRef={tabListRef} />
              </>
            )}
          </div>
          <div
            data-composer-tools-scroll="true"
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2"
          >
            {currentView === 'search-scope' ? (
              scopeBody
            ) : (
              <>
                <div
                  role="tabpanel"
                  id={composerToolsPanelId(idBase, 'capabilities')}
                  aria-labelledby={composerToolsTabId(idBase, 'capabilities')}
                  hidden={activeTab !== 'capabilities'}
                >
                  {capabilitiesSection}
                </div>
                <div
                  role="tabpanel"
                  id={composerToolsPanelId(idBase, 'context')}
                  aria-labelledby={composerToolsTabId(idBase, 'context')}
                  hidden={activeTab !== 'context'}
                >
                  {contextSection}
                </div>
              </>
            )}
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
      <PopoverTrigger asChild>{defaultTrigger}</PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-[27rem] max-w-[calc(100vw-2rem)] rounded-xl border-border bg-surface p-2"
      >
        {currentView === 'search-scope' ? scopeHeader : panelHeader}
        <div
          data-composer-tools-desktop-scroll="true"
          className="max-h-[min(60vh,30rem)] overflow-y-auto overscroll-contain"
        >
          {currentView === 'search-scope' ? scopeSection : desktopSections}
        </div>
      </PopoverContent>
    </Popover>
  )
}