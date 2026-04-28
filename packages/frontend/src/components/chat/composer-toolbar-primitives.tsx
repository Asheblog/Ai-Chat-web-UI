import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { BookOpen, Brain, Code2, Globe2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export const composerInnerEditorClass =
  'relative overflow-hidden rounded-[10px] border border-border bg-card shadow-[inset_0_1px_0_hsl(var(--background)/0.05)] transition-colors focus-within:border-primary/35 focus-within:ring-2 focus-within:ring-primary/10'

export const composerToolbarScrollClass =
  'flex min-w-0 max-w-full flex-nowrap items-center gap-1 overflow-visible pr-0 sm:gap-1.5'

export const composerToolbarButtonClass =
  'relative inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[8px] border border-border bg-card text-muted-foreground shadow-[0_1px_2px_hsl(var(--background)/0.25)] transition-colors hover:border-primary/25 hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-45 sm:h-9 sm:w-9'

interface ComposerIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
}

export function ComposerIconButton({
  active,
  className,
  type = 'button',
  children,
  ...props
}: ComposerIconButtonProps) {
  return (
    <button
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
}

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
          className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_0_3px_rgba(37,99,235,0.10)]"
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
          <BookOpen className="h-4 w-4" />
          {Boolean(knowledgeBaseCount && knowledgeBaseCount > 0) && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {knowledgeBaseCount! > 9 ? '9+' : knowledgeBaseCount}
            </span>
          )}
        </ComposerIconButton>
      ) : null}

      <ComposerFeatureChip
        active={thinkingEnabled}
        disabled={disabled}
        icon={<Brain className="h-4 w-4" />}
        label="思考"
        onClick={() => onToggleThinking(!thinkingEnabled)}
      />
      <ComposerFeatureChip
        active={webSearchEnabled}
        disabled={disabled || !canUseWebSearch}
        icon={<Globe2 className="h-4 w-4" />}
        label="联网"
        title={!canUseWebSearch ? webSearchDisabledNote : undefined}
        onClick={() => onToggleWebSearch(!webSearchEnabled)}
      />
      <ComposerFeatureChip
        active={pythonToolEnabled}
        disabled={disabled || !canUsePythonTool}
        icon={<Code2 className="h-4 w-4" />}
        label="Python"
        title={!canUsePythonTool ? pythonToolDisabledNote : undefined}
        onClick={() => onTogglePythonTool(!pythonToolEnabled)}
      />
    </>
  )
}
