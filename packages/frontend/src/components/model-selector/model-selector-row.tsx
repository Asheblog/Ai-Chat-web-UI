import { Check } from 'lucide-react'
import type { ModelItem } from '@/store/models-store'
import { formatModelOptionLabel } from '@/lib/model-display'
import { formatModelSelectorSource } from './model-selector-utils'
import { cn } from '@/lib/utils'

interface ModelSelectorRowProps {
  model: ModelItem
  selected: boolean
  onSelect: (model: ModelItem) => void
}

export function ModelSelectorRow({ model, selected, onSelect }: ModelSelectorRowProps) {
  const label = formatModelOptionLabel(model)
  const source = formatModelSelectorSource(model)

  return (
    <li data-model-row="" data-selected={selected} className="min-w-0">
      <button
        type="button"
        data-model-select=""
        onClick={() => onSelect(model)}
        aria-label={label}
        title={source ? model.name + ' · ' + source : model.name}
        aria-pressed={selected}
        className={cn(
          'flex min-h-16 w-full min-w-0 items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors duration-[160ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal motion-reduce:transition-none',
          selected ? 'bg-signal-soft' : 'hover:bg-surface-hover active:bg-surface-subtle',
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 break-words text-sm font-medium leading-5 text-foreground [overflow-wrap:anywhere]">{model.name}</span>
          {source && <span className="mt-1 block truncate text-xs leading-4 text-muted-foreground" title={source}>{source}</span>}
        </span>
        {selected && <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-signal-text" />}
      </button>
    </li>
  )
}
