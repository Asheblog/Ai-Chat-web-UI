"use client"
import { ReactNode, useCallback, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import type { SettingsNavItem } from "./nav"
import { ChevronDown, ChevronRight } from "lucide-react"
import { useNavFlash } from "./use-nav-flash"
import { SettingsShellLayout, SettingsContentColumn } from "./shell-layout"

export interface SettingsSection {
  key: string
  label: string
  icon?: ReactNode
}

type BaseProps = {
  title?: string
  className?: string
  bare?: boolean
  showNavTitle?: boolean
  children: ReactNode
}

type FlatModeProps = {
  mode?: "flat"
  sections: SettingsSection[]
  active: string
  onChange: (key: string) => void
}

type NestedModeProps = {
  mode: "nested"
  tree: SettingsNavItem[]
  /** 弹窗从个人/系统分区开始；独立页默认直接显示目录。 */
  rootLayout?: "sections" | "directories"
  activeMain: string
  activeSub: string
  onChangeMain: (key: string) => void
  onChangeSub: (key: string) => void
  readOnly?: boolean
  readOnlyMessage?: string
  navTop?: ReactNode
  /** 需要闪烁提示的叶子 key（搜索跳转后的位置提醒）；闪烁结束后由宿主通过 onFlashDone 清空 */
  flashKey?: string | null
  /** 目标叶子闪烁动画结束后的回调（用于清除 flashKey） */
  onFlashDone?: () => void
}

export type SettingsShellProps = BaseProps & (FlatModeProps | NestedModeProps)

// 一级分区用紧凑标题与分隔留白；目录图标和文字共列，所有折叠箭头固定在行尾。
const NAV_GROUP = "flex h-11 md:h-10 w-full items-center gap-2 rounded-lg border border-transparent px-2 text-left text-sm text-ink-secondary transition-colors duration-[160ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-hover hover:text-foreground"
const NAV_SECTION = "text-[13px] font-semibold tracking-wide text-foreground"
const NAV_LEAF = "relative flex h-11 md:h-10 w-full items-center gap-2 rounded-lg border px-2 text-left text-sm transition-colors duration-[160ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
const NAV_LEAF_ACTIVE = "border-transparent bg-signal-soft font-semibold text-signal-text"
const NAV_LEAF_IDLE = "border-transparent text-ink-secondary hover:bg-surface-hover hover:text-foreground"
const NAV_ICON = "h-[1.125rem] w-[1.125rem] shrink-0"
const NAV_LIST = "flex flex-col gap-0.5"

/** 选中条叠在行的左侧边缘，不占图标列，普通叶子与折叠目录保持同一文字起点。 */
function NavBar({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn("absolute left-0 top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full", active ? "bg-signal" : "bg-transparent")}
    />
  )
}

function NavChevron({ open }: { open: boolean }) {
  return open ? (
    <ChevronDown data-nav-chevron="" className="h-3.5 w-3.5 shrink-0 text-ink-tertiary" aria-hidden="true" />
  ) : (
    <ChevronRight data-nav-chevron="" className="h-3.5 w-3.5 shrink-0 text-ink-tertiary" aria-hidden="true" />
  )
}

/**
 * SettingsShell: 统一支持扁平与树形导航的设置容器。
 * 外壳 = 252 宽导航列（右发丝线）+ 内容列（个人 752 / 系统 988 居中）。
 * 导航列走画布底色、内容列走白底，卡片再靠发丝线分层——全程不用阴影。
 */
export function SettingsShell(props: SettingsShellProps) {
  if (props.mode === "nested") {
    return <SettingsShellNestedImpl {...props} />
  }
  return <SettingsShellFlatImpl {...props} />
}

function SettingsShellFlatImpl({
  title = "设置",
  sections,
  active,
  onChange,
  children,
  className,
  showNavTitle,
}: BaseProps & FlatModeProps) {
  const nav = (
    <nav className={NAV_LIST} aria-label="设置导航">
      {sections.map((s) => {
        const isActive = active === s.key
        return (
          <button
            key={s.key}
            type="button"
            data-leaf-key={s.key}
            data-active={isActive || undefined}
            aria-current={isActive ? "page" : undefined}
            onClick={() => onChange(s.key)}
            className={cn(NAV_LEAF, isActive ? NAV_LEAF_ACTIVE : NAV_LEAF_IDLE)}
          >
            <NavBar active={isActive} />
            {s.icon && <span className={cn(NAV_ICON, isActive ? "text-foreground" : "text-ink-tertiary")}>{s.icon}</span>}
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
          </button>
        )
      })}
    </nav>
  )

  return (
    <SettingsShellLayout
      title={title}
      activeKey={active}
      activeLabel={sections.find(section => section.key === active)?.label ?? title}
      className={className}
      nav={nav}
      showNavTitle={showNavTitle}
      content={
        <SettingsContentColumn measureClassName="max-w-[752px]" resetKey={active}>
          {children}
        </SettingsContentColumn>
      }
    />
  )
}

function findNavLabel(tree: SettingsNavItem[], key: string): string | undefined {
  for (const item of tree) {
    if (item.key === key) return item.label
    const label = item.children && findNavLabel(item.children, key)
    if (label) return label
  }
}

/** Walk the tree to find ancestor chain leading to targetKey (exclusive of target itself). */
function findAncestors(tree: SettingsNavItem[], targetKey: string): string[] {
  for (const item of tree) {
    if (item.key === targetKey) return []
    if (item.children) {
      const found = findAncestors(item.children, targetKey)
      if (found.length > 0 || item.children.some((c) => c.key === targetKey)) {
        return [item.key, ...found]
      }
    }
  }
  return []
}

function SettingsShellNestedImpl({
  title = "设置",
  tree,
  rootLayout = "directories",
  activeMain,
  activeSub,
  onChangeMain,
  onChangeSub,
  readOnly = false,
  readOnlyMessage,
  navTop,
  flashKey,
  onFlashDone,
  children,
  className,
  showNavTitle,
}: BaseProps & NestedModeProps) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())
  const navRef = useRef<HTMLDivElement>(null)
  const onFlashDoneRef = useRef(onFlashDone)
  useEffect(() => { onFlashDoneRef.current = onFlashDone }, [onFlashDone])

  // 展开指定 key 的祖先分组（auto-expand 与导航闪烁共用）
  const expandAncestors = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      findAncestors(tree, key).forEach((a) => next.add(a))
      return next
    })
  }, [tree])

  // Auto-expand ancestors when activeMain or activeSub changes so active leaf is visible
  useEffect(() => {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (activeMain) next.add(activeMain)
      return next
    })
    expandAncestors(activeSub)
  }, [tree, activeMain, activeSub, expandAncestors])

  // Flash highlight: expand target leaf's ancestors, scroll it into view,
  // run the one-shot .settings-flash animation, then notify onFlashDone.
  useNavFlash({ navRef, flashKey, onFlashDone, expandAncestors })

  const toggleExpand = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  /** Recursive render. rootKey tracks which top-level root the current sub-tree belongs to. */
  const renderItems = (items: SettingsNavItem[], depth: number, rootKey?: string) =>
    items.map((item) => {
      const hasChildren = !!(item.children && item.children.length > 0)
      const isExpanded = expandedKeys.has(item.key)
      const isActiveMain = item.key === activeMain
      const isActiveLeaf = !hasChildren && activeSub === item.key
      const itemRootKey = depth === 0 ? item.key : rootKey
      const isChildLeaf = depth > (rootLayout === "sections" ? 1 : 0)

      if (hasChildren) {
        const isSection = depth === 0 && rootLayout === "sections"
        const toggle = (
          <button
            type="button"
            data-nav-section={isSection ? "" : undefined}
            aria-expanded={isExpanded}
            onClick={() => {
              if (depth === 0 && !isExpanded) onChangeMain(item.key)
              toggleExpand(item.key)
            }}
            className={cn(NAV_GROUP, isSection && NAV_SECTION, isActiveMain && "text-foreground")}
          >
            {item.icon && <span aria-hidden="true" className={cn(NAV_ICON, "text-ink-tertiary")}>{item.icon}</span>}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <NavChevron open={isExpanded} />
          </button>
        )
        return (
          <div key={item.key} className={isSection ? "mt-4 border-t border-border pt-3 first:mt-0 first:border-t-0 first:pt-0" : undefined}>
            {isSection ? <h3>{toggle}</h3> : toggle}
            {isExpanded && (
              // 17px = 行边框1 + 左内边距8 + 图标中心9 - 引导线1；子项文字与父目录标签共列。
              <div className={cn(NAV_LIST, "mt-1", !isSection && "ml-[17px] border-l border-border pl-2")}>
                {renderItems(item.children || [], depth + 1, itemRootKey)}
              </div>
            )}
          </div>
        )
      }

      // 叶子：整行可点，选中态由 data-active / aria-current 标出
      const Icon = item.icon
      return (
        <button
          key={item.key}
          type="button"
          data-leaf-key={item.key}
          data-active={isActiveLeaf || undefined}
          aria-current={isActiveLeaf ? "page" : undefined}
          onClick={() => {
            // Sync activeMain if leaf belongs to a different root
            if (itemRootKey && itemRootKey !== activeMain) onChangeMain(itemRootKey)
            onChangeSub(item.key)
          }}
          className={cn(NAV_LEAF, isActiveLeaf ? NAV_LEAF_ACTIVE : NAV_LEAF_IDLE)}
        >
          <NavBar active={isActiveLeaf} />
          {!isChildLeaf && <span aria-hidden="true" className={cn(NAV_ICON, isActiveLeaf ? "text-foreground" : "text-ink-tertiary")}>{Icon}</span>}
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
        </button>
      )
    })

  const nav = (
    <div ref={navRef} className="flex flex-col gap-2">
      {navTop}
      <nav className={NAV_LIST} aria-label="设置导航">{renderItems(tree, 0)}</nav>
    </div>
  )

  return (
    <SettingsShellLayout
      title={title}
      activeKey={activeSub}
      activeLabel={findNavLabel(tree, activeSub) ?? title}
      className={className}
      nav={nav}
      showNavTitle={showNavTitle}
      asideClassName="scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent hover:scrollbar-thumb-muted-foreground"
      content={
        <SettingsContentColumn
          measureClassName="max-w-[988px]"
          resetKey={activeSub}
          // 卡定位期间不要重置：否则 SystemLeafWrapper 刚滚到卡片，会被推回标题处
          skipScrollReset={Boolean(flashKey)}
          dimmed={readOnly}
          notice={
            readOnly ? (
              <div className="border-b border-border bg-surface-subtle px-5 py-2.5 text-[11.5px] leading-[1.55] text-ink-tertiary">
                {readOnlyMessage || "当前模式下无法编辑设置，请登录后再试。"}
              </div>
            ) : undefined
          }
        >
          <div aria-readonly={readOnly || undefined}>{children}</div>
        </SettingsContentColumn>
      }
    />
  )
}
