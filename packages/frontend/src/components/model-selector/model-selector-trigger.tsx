import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import type { ModelItem } from '@/store/models-store'
import { cn } from '@/lib/utils'
import { formatModelOptionLabel } from '@/lib/model-display'
import { formatModelSelectorSource } from './model-selector-utils'
import { Button } from '@/components/ui/button'

interface ModelSelectorTriggerProps extends Omit<React.ComponentPropsWithoutRef<typeof Button>, 'variant' | 'children'> {
  open: boolean
  selected?: ModelItem
  displayVariant: 'default' | 'inline'
  selectorSize: 'sm' | 'md' | 'lg'
}

export const ModelSelectorTrigger = React.forwardRef<React.ElementRef<typeof Button>, ModelSelectorTriggerProps>(
  ({ open, selected, className, displayVariant, selectorSize, ...buttonProps }, ref) => {
    const source = selected ? formatModelSelectorSource(selected) : null
    const inline = displayVariant === 'inline'
    const sizeClass = selectorSize === 'sm' ? 'h-11 w-[180px] px-2.5 md:h-9'
      : selectorSize === 'lg' ? 'h-12 w-[280px] px-4' : 'h-11 w-[240px] px-3'
    return (
      <Button ref={ref} type="button" variant="outline" role="combobox" aria-haspopup="dialog" aria-expanded={open} aria-label="选择模型" title={selected ? formatModelOptionLabel(selected) : '选择模型'}
        className={cn('min-w-0 max-w-full justify-between gap-2 rounded-lg border-border bg-background text-foreground shadow-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-signal', inline ? 'h-11 max-w-[min(16rem,46vw)] px-2.5 md:h-9' : sizeClass, className)} {...buttonProps}>
        <span className="min-w-0 flex-1 text-left">
          <span className={cn('block truncate font-medium', inline ? 'text-xs md:text-sm' : 'text-sm')}>{selected ? selected.name : '选择模型'}</span>
          {!inline && selected && source && <span className="block truncate text-[11px] text-muted-foreground">{source}</span>}
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', open && 'rotate-180')} />
      </Button>
    )
  }
)
ModelSelectorTrigger.displayName = 'ModelSelectorTrigger'
