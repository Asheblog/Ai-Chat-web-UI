import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { BookOpen, Brain, Code2, Globe2, Microscope } from 'lucide-react'
import { cn } from '@/lib/utils'

export const composerInnerEditorClass =
  'composer-inner-editor relative overflow-hidden rounded-[var(--radius-composer)] border border-borderStrong bg-surface transition-colors duration-[160ms] focus-within:border-signal'

/** Named container + scroll fallback; sizes come from `.composer-toolbar*` in globals.css */
export const composerToolbarScrollClass =
  'composer-toolbar flex min-w-0 max-w-full flex-nowrap items-center overflow-x-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'

export const composerToolbarButtonClass =
  'composer-toolbar-btn relative inline-flex shrink-0 touch-manipulation cursor-pointer items-center justify-center rounded-[8px] border border-transparent bg-transparent text-ink-tertiary transition-colors duration-[160ms] hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-45'

export const composerToolbarIconClass = 'composer-toolbar-icon'

/** Isolates send/stop from toolbar overflow / paint */
export const composerToolbarSendSlotClass = 'relative z-10 shrink-0'

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

interface ComposerFeatureChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  icon: ReactNode
  label: string
  showDot?: boolean
}

export function ComposerFeatureChip({
  active,
  icon,
  label,
  showDot = true,
  className,
  type = 'button',
  title,
  'aria-label': ariaLabel,
  ...props
}: ComposerFeatureChipProps) {
  return (
    <button
      type={type}
      aria-pressed={active}
      aria-label={ariaLabel ?? label}
      title={title ?? label}
      className={cn(
        composerToolbarButtonClass,
        active && 'border-signal/40 bg-signal-soft text-signal-text',
        className,
      )}
      {...props}
    >
      {icon}
      {showDot && active && (
        <span
          className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-signal"
          aria-hidden="true"
        />
      )}
    </button>
  )
}

export function ComposerToolbarDivider() {
  return <span className="mx-0.5 h-5 w-px shrink-0 bg-border sm:mx-1" aria-hidden="true" />
}

interface ComposerFeatureControlsProps {
  disabled?: boolean
  thinkingEnabled: boolean
  onToggleThinking: (value: boolean) => void
  webSearchEnabled: boolean
  onToggleWebSearch: (value: boolean) => void
  canUseWebSearch: boolean
  webSearchDisabledNote?: string
  deepResearchEnabled: boolean
  onToggleDeepResearch: (value: boolean) => void
  pythonToolEnabled: boolean
  onTogglePythonTool: (value: boolean) => void
  canUsePythonTool: boolean
  pythonToolDisabledNote?: string
  knowledgeBaseEnabled?: boolean
  knowledgeBaseCount?: number
  onOpenKnowledgeBase?: () => void
}

export function ComposerFeatureControls({
  disabled,
  thinkingEnabled,
  onToggleThinking,
  webSearchEnabled,
  onToggleWebSearch,
  canUseWebSearch,
  webSearchDisabledNote,
  deepResearchEnabled,
  onToggleDeepResearch,
  pythonToolEnabled,
  onTogglePythonTool,
  canUsePythonTool,
  pythonToolDisabledNote,
  knowledgeBaseEnabled,
  knowledgeBaseCount,
  onOpenKnowledgeBase,
}: ComposerFeatureControlsProps) {
  return (
    <>
      <ComposerToolbarDivider />

      {onOpenKnowledgeBase ? (
        <ComposerIconButton
          active={Boolean(knowledgeBaseCount && knowledgeBaseCount > 0)}
          onClick={onOpenKnowledgeBase}
          aria-label="知识库"
          title={knowledgeBaseEnabled ? '知识库' : '知识库未启用'}
          disabled={disabled || !knowledgeBaseEnabled}
        >
          <BookOpen className={composerToolbarIconClass} />
          {Boolean(knowledgeBaseCount && knowledgeBaseCount > 0) && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-medium text-background">
              {knowledgeBaseCount! > 9 ? '9+' : knowledgeBaseCount}
            </span>
          )}
        </ComposerIconButton>
      ) : null}

      <ComposerFeatureChip
        active={thinkingEnabled}
        disabled={disabled}
        icon={<Brain className={composerToolbarIconClass} />}
        label="思考"
        onClick={() => onToggleThinking(!thinkingEnabled)}
      />
      <ComposerFeatureChip
        active={webSearchEnabled}
        disabled={disabled || !canUseWebSearch}
        icon={<Globe2 className={composerToolbarIconClass} />}
        label="联网"
        title={!canUseWebSearch ? webSearchDisabledNote : undefined}
        onClick={() => onToggleWebSearch(!webSearchEnabled)}
      />
      <ComposerFeatureChip
        active={deepResearchEnabled}
        disabled={disabled}
        icon={<Microscope className={composerToolbarIconClass} />}
        label="深度研究"
        onClick={() => onToggleDeepResearch(!deepResearchEnabled)}
      />
      <ComposerFeatureChip
        active={pythonToolEnabled}
        disabled={disabled || !canUsePythonTool}
        icon={<Code2 className={composerToolbarIconClass} />}
        label="Python"
        title={!canUsePythonTool ? pythonToolDisabledNote : undefined}
        onClick={() => onTogglePythonTool(!pythonToolEnabled)}
      />
    </>
  )
}
