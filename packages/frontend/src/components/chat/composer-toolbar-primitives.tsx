import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { BookOpen, Brain, Code2, Globe2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export const composerInnerEditorClass =
  'relative overflow-hidden rounded-[10px] border border-slate-200 bg-white shadow-[inset_0_1px_0_rgba(15,23,42,0.02)] transition-colors focus-within:border-primary/35 focus-within:ring-2 focus-within:ring-primary/10'

export const composerToolbarScrollClass =
  'flex min-w-0 items-center gap-1.5 overflow-x-auto overscroll-contain pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'

export const composerToolbarButtonClass =
  'relative inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[8px] border border-slate-200 bg-white text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-primary/25 hover:bg-blue-50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-45'

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
  ...props
}: ComposerFeatureChipProps) {
  return (
    <button
      type={type}
      aria-pressed={active}
      className={cn(
        'inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-[8px] border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-primary/25 hover:bg-blue-50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-45',
        active && 'border-primary/35 bg-primary/5 text-primary',
        className,
      )}
      {...props}
    >
      {icon}
      <span className="whitespace-nowrap">{label}</span>
      {showDot && (
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full bg-slate-300',
            active && 'bg-primary shadow-[0_0_0_3px_rgba(37,99,235,0.10)]',
          )}
        />
      )}
    </button>
  )
}

export function ComposerToolbarDivider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-slate-200" aria-hidden="true" />
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
        icon={<Brain className="h-3.5 w-3.5" />}
        label="思考"
        onClick={() => onToggleThinking(!thinkingEnabled)}
      />
      <ComposerFeatureChip
        active={webSearchEnabled}
        disabled={disabled || !canUseWebSearch}
        icon={<Globe2 className="h-3.5 w-3.5" />}
        label="联网"
        title={!canUseWebSearch ? webSearchDisabledNote : undefined}
        onClick={() => onToggleWebSearch(!webSearchEnabled)}
      />
      <ComposerFeatureChip
        active={pythonToolEnabled}
        disabled={disabled || !canUsePythonTool}
        icon={<Code2 className="h-3.5 w-3.5" />}
        label="Python"
        title={!canUsePythonTool ? pythonToolDisabledNote : undefined}
        onClick={() => onTogglePythonTool(!pythonToolEnabled)}
      />
    </>
  )
}
