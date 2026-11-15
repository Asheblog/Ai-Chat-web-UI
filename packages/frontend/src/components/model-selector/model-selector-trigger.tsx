import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import type { ModelItem } from '@/store/models-store'
import { cn } from '@/lib/utils'
import { formatModelOptionLabel } from '@/lib/model-display'
import { formatModelSelectorSource } from './model-selector-utils'
import { formatModelReasoningEffortLabel } from './model-selector-effort'
import type { ModelReasoningEffort } from './model-selector-types'
import { Button } from '@/components/ui/button'

interface ModelSelectorTriggerProps extends Omit<React.ComponentPropsWithoutRef<typeof Button>, 'variant' | 'children'> {
  open: boolean
  selected?: ModelItem
  displayVariant: 'default' | 'inline'
  selectorSize: 'sm' | 'md' | 'lg'
  effort?: ModelReasoningEffort
}

export const ModelSelectorTrigger = React.forwardRef<React.ElementRef<typeof Button>, ModelSelectorTriggerProps>(
  ({ open, selected, className, displayVariant, selectorSize, effort, ...buttonProps }, ref) => {
    const source = selected ? formatModelSelectorSource(selected) : null
    const inline = displayVariant === 'inline'
    const effortLabel = effort ? formatModelReasoningEffortLabel(effort) : null
    const sizeClass = selectorSize === 'sm' ? 'h-11 w-[180px] px-2.5 md:h-9'
      : selectorSize === 'lg' ? 'h-12 w-[280px] px-4' : 'h-11 w-[240px] px-3'
    const title = selected
      ? formatModelOptionLabel(selected) + (effortLabel ? ` · 思考强度 ${effortLabel}` : '')
      : '选择模型'
    return (
      <Button ref={ref} type="button" variant="outline" role="combobox" aria-haspopup="dialog" aria-expanded={open} aria-label="选择模型" title={title}
        className={cn(
          'min-w-0 max-w-full justify-between gap-2 rounded-lg shadow-none transition-colors duration-[160ms] focus-visible:ring-2 focus-visible:ring-signal',
          effortLabel ? 'border-transparent bg-surface-subtle text-foreground hover:bg-surface-hover' : 'border-border bg-background text-foreground hover:bg-surface-hover',
          inline ? 'h-11 max-w-[min(16rem,46vw)] px-2.5 md:h-9' : sizeClass, className)} {...buttonProps}>
        {effortLabel ? (
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
            <span className={cn('truncate font-medium', inline ? 'text-xs md:text-sm' : 'text-sm')}>{selected ? selected.name : '选择模型'}</span>
            <span className="shrink-0 text-xs leading-4 text-muted-foreground">{effortLabel}</span>
          </span>
        ) : (
          <span className="min-w-0 flex-1 text-left">
            <span className={cn('block truncate font-medium', inline ? 'text-xs md:text-sm' : 'text-sm')}>{selected ? selected.name : '选择模型'}</span>
            {!inline && selected && source && <span className="block truncate text-[11px] text-muted-foreground">{source}</span>}
          </span>
        )}
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', open && 'rotate-180')} />
      </Button>
    )
  }
)
ModelSelectorTrigger.displayName = 'ModelSelectorTrigger'
