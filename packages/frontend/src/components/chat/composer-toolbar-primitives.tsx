import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { BookOpen, Brain, Code2, Globe2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export const composerInnerEditorClass =
  'relative overflow-hidden rounded-[var(--radius-composer)] border border-border/80 bg-background transition-colors duration-200 focus-within:border-primary/35 focus-within:ring-2 focus-within:ring-primary/10'

/** Named container + scroll fallback; sizes come from `.composer-toolbar*` in globals.css */
export const composerToolbarScrollClass =
  'composer-toolbar flex min-w-0 max-w-full flex-nowrap items-center overflow-x-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'

export const composerToolbarButtonClass =
  'composer-toolbar-btn relative inline-flex shrink-0 touch-manipulation cursor-pointer items-center justify-center rounded-lg border border-border/80 bg-background text-muted-foreground transition-colors duration-200 hover:border-primary/25 hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-45'

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
          active && 'border-primary/35 bg-primary/5 text-primary',
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
        active && 'border-primary/35 bg-primary/5 text-primary',
        className,
      )}
      {...props}
    >
      {icon}
      {showDot && active && (
        <span
          className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.10)]"
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
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-micro font-semibold text-primary-foreground">
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
