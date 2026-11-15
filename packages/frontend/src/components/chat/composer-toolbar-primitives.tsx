import { forwardRef, type ButtonHTMLAttributes, type ComponentType } from 'react'
import { Brain, Code2, Globe2, Microscope, SlidersHorizontal } from 'lucide-react'
import { WEB_SEARCH_SCOPE_IDS, type WebSearchScope } from '@aichat/shared'
import { cn } from '@/lib/utils'

export const composerInnerEditorClass =
  'composer-inner-editor relative overflow-hidden rounded-[var(--radius-composer)] border border-borderStrong bg-surface transition-colors duration-[160ms] focus-within:border-signal'

/** Scroll tools independently; target sizes come from .composer-toolbar* in globals.css. */
export const composerToolbarScrollClass =
  'composer-toolbar flex min-w-0 max-w-full flex-nowrap items-center overflow-x-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'

export const composerToolbarButtonClass =
  'composer-toolbar-btn relative inline-flex shrink-0 touch-manipulation cursor-pointer items-center justify-center rounded-[8px] border border-transparent bg-transparent text-ink-tertiary transition-colors duration-[160ms] hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-45'

export const composerToolbarIconClass = 'composer-toolbar-icon'

/** Isolates send/stop from toolbar overflow / paint */
export const composerToolbarSendSlotClass = 'relative z-10 shrink-0'

/** 工具入口：图标 + 文字，手机 44px、桌面 36px 触控区（Figma 01 / 03）。 */
export const composerToolsTriggerClass =
  'composer-tools-trigger inline-flex h-11 shrink-0 touch-manipulation cursor-pointer items-center gap-1.5 rounded-[8px] border border-transparent bg-transparent px-2 text-[13px] text-ink-tertiary transition-colors duration-[160ms] hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-45 md:h-9'

export type ComposerCapabilityId = 'thinking' | 'web-search' | 'deep-research' | 'python'

export interface ComposerCapabilityMeta {
  id: ComposerCapabilityId
  /** 输入区回显标签用的短名。 */
  label: string
  /** 工具面板行标题（与短名不同的两项在这里写全称）。 */
  panelLabel: string
  description: string
  Icon: ComponentType<{ className?: string }>
}

/** 能力名、图标与说明的唯一来源：输入区标签与工具面板行共用。 */
export const COMPOSER_CAPABILITIES: readonly ComposerCapabilityMeta[] = [
  { id: 'thinking', label: '思考', panelLabel: '深度思考', description: '先推理，再回答', Icon: Brain },
  { id: 'web-search', label: '联网', panelLabel: '联网搜索', description: '检索最新网页内容', Icon: Globe2 },
  { id: 'deep-research', label: '深度研究', panelLabel: '深度研究', description: '规划、检索并整理成报告', Icon: Microscope },
  { id: 'python', label: 'Python', panelLabel: 'Python', description: '计算与数据分析', Icon: Code2 },
]

export const getComposerCapability = (id: ComposerCapabilityId): ComposerCapabilityMeta => {
  const found = COMPOSER_CAPABILITIES.find((capability) => capability.id === id)
  if (!found) throw new Error('未知能力 id：' + id)
  return found
}

/**
 * 联网搜索范围标签：取值来自 shared 的 WEB_SEARCH_SCOPE_IDS（七项，含 scholar/学术），
 * Record 让漏标签在编译期报错，避免输入区再存一份少一项的枚举。
 */
export const WEB_SEARCH_SCOPE_LABELS: Record<WebSearchScope, string> = {
  webpage: '网页',
  document: '文档',
  paper: '论文',
  scholar: '学术',
  image: '图片',
  video: '视频',
  podcast: '播客',
}

export const WEB_SEARCH_SCOPE_OPTIONS: ReadonlyArray<{ value: WebSearchScope; label: string }> =
  WEB_SEARCH_SCOPE_IDS.map((value) => ({ value, label: WEB_SEARCH_SCOPE_LABELS[value] }))

/**
 * 偏好值可能来自 localStorage 的手工写入，因此只认自有属性；
 * 用 in 会命中 constructor / __proto__ 等原型键并渲染非字符串。
 */
export const formatWebSearchScopeLabel = (value: string | undefined): string => {
  if (value && Object.prototype.hasOwnProperty.call(WEB_SEARCH_SCOPE_LABELS, value)) {
    return WEB_SEARCH_SCOPE_LABELS[value as WebSearchScope]
  }
  return value || WEB_SEARCH_SCOPE_LABELS.webpage
}

interface ComposerIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
}

export const ComposerIconButton = forwardRef<HTMLButtonElement, ComposerIconButtonProps>(
  ({ active, className, type = 'button', children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          composerToolbarButtonClass,
          active && 'border-signal/40 bg-signal-soft text-signal-text',
          className,
        )}
        {...props}
      >
        {children}
      </button>
    )
  },
)
ComposerIconButton.displayName = 'ComposerIconButton'

interface ComposerToolsTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  expanded?: boolean
}

/** 工具面板的默认触发器；上层也可用 trigger 传入自己的按钮。 */
export const ComposerToolsTrigger = forwardRef<HTMLButtonElement, ComposerToolsTriggerProps>(
  ({ expanded, className, type = 'button', children, ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-label="工具"
      aria-expanded={expanded ?? false}
      className={cn(composerToolsTriggerClass, className)}
      {...props}
    >
      <SlidersHorizontal className={composerToolbarIconClass} aria-hidden="true" />
      {children ?? <span>工具</span>}
    </button>
  ),
)
ComposerToolsTrigger.displayName = 'ComposerToolsTrigger'
