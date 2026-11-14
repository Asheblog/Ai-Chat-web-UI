import type { MouseEvent } from 'react'
import { Check, Star } from 'lucide-react'
import type { ModelItem } from '@/store/models-store'
import { modelKeyFor } from '@/store/model-preference-store'
import { formatModelOptionLabel, formatModelSecondaryLabel } from '@/lib/model-display'
import { cn } from '@/lib/utils'
import { ModelSelectorCapabilityBadges } from './model-selector-capability-badges'
import { formatContextWindow } from './model-selector-utils'

interface ModelSelectorRowProps {
  model: ModelItem
  selected: boolean
  favorite: boolean
  onSelect: (model: ModelItem) => void
  onToggleFavorite: (modelId: string, event: MouseEvent<HTMLButtonElement>) => void
}

export function ModelSelectorRow({ model, selected, favorite, onSelect, onToggleFavorite }: ModelSelectorRowProps) {
  const label = formatModelOptionLabel(model)
  const source = formatModelSecondaryLabel(model)
  const context = typeof model.contextWindow === 'number' && model.contextWindow > 0
    ? formatContextWindow(model.contextWindow)
    : null

  return (
    <div
      role="listitem"
      data-model-row=""
      data-selected={selected}
      className={cn(
        'mb-1 flex min-w-0 items-center gap-1 rounded-lg border px-2 transition-colors',
        selected ? 'border-signal/25 bg-signal-soft' : 'border-transparent hover:bg-surface-hover',
      )}
    >
      <button
        type="button"
        data-model-select=""
        onClick={() => onSelect(model)}
        aria-label={label}
        title={label}
        aria-pressed={selected}
        className="flex min-h-[66px] min-w-0 flex-1 items-center gap-2.5 rounded-md py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
          {selected && <Check className="h-4 w-4 text-signal-text" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold leading-5 text-foreground">{model.name}</span>
          <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-4 text-muted-foreground">
            {source && <span className="max-w-full truncate" title={source}>{source}</span>}
            <ModelSelectorCapabilityBadges model={model} />
            {context && (
              <span className="shrink-0 tabular-nums" title={'上下文窗口 ' + model.contextWindow + ' tokens'}>
                {context} 上下文
              </span>
            )}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={event => onToggleFavorite(modelKeyFor(model), event)}
        aria-label={favorite ? '取消收藏' : '收藏'}
        aria-pressed={favorite}
        title={(favorite ? '取消收藏 ' : '收藏 ') + label}
        className={cn(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal md:h-9 md:w-9',
          favorite ? 'text-signal-text' : 'text-muted-foreground',
        )}
      >
        <Star aria-hidden="true" className={cn('h-4 w-4', favorite && 'fill-current')} />
      </button>
    </div>
  )
}
