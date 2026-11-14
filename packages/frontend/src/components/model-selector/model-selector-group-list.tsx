import type { MouseEvent } from 'react'
import type { ModelItem } from '@/store/models-store'
import { cn } from '@/lib/utils'
import { modelKeyFor } from '@/store/model-preference-store'
import { Skeleton } from '@/components/ui/skeleton'
import { ModelSelectorRow } from './model-selector-row'

interface ModelSelectorGroupListProps {
  loading: boolean
  groupedModels: Record<string, ModelItem[]>
  activeGroup: string | null
  onActiveGroupChange: (group: string) => void
  isModelSelected: (model: ModelItem) => boolean
  favoriteModelKeys: Set<string>
  onSelectModel: (model: ModelItem) => void
  onToggleFavorite: (modelId: string, event: MouseEvent<HTMLButtonElement>) => void
  emptyText: string
  layout?: 'desktop' | 'mobile'
}

export function ModelSelectorGroupList({
  loading, groupedModels, activeGroup, onActiveGroupChange, isModelSelected,
  favoriteModelKeys, onSelectModel, onToggleFavorite, emptyText, layout = 'desktop',
}: ModelSelectorGroupListProps) {
  const groupNames = Object.keys(groupedModels)
  const resolvedGroup = activeGroup && groupedModels[activeGroup] ? activeGroup : groupNames[0] ?? null
  const activeModels = resolvedGroup ? groupedModels[resolvedGroup] ?? [] : []
  const mobile = layout === 'mobile'

  if (loading) {
    return (
      <div role="status" aria-label="正在加载模型" className="min-h-0 flex-1 space-y-2 overflow-hidden p-3">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="rounded-lg border border-border p-3">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="mt-2 h-3 w-28" />
          </div>
        ))}
      </div>
    )
  }
  if (!groupNames.length) {
    return <div role="status" className="px-4 py-12 text-center text-sm text-muted-foreground">{emptyText}</div>
  }

  return (
    <div className={cn('min-h-0 flex-1 overflow-hidden', mobile ? 'flex flex-col' : 'grid grid-cols-[144px_minmax(0,1fr)]')}>
      <div
        aria-label="模型家族"
        className={cn(mobile
          ? 'flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-3 py-2'
          : 'min-h-0 overflow-y-auto border-r border-border bg-surface-subtle p-2',
        )}
      >
        {groupNames.map(group => (
          <button
            key={group}
            type="button"
            data-model-group=""
            onClick={() => onActiveGroupChange(group)}
            aria-pressed={resolvedGroup === group}
            title={group}
            className={cn(
              'flex items-center justify-between gap-2 rounded-lg px-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal',
              mobile ? 'h-11 shrink-0' : 'mb-1 h-9 w-full',
              resolvedGroup === group ? 'bg-signal-soft text-signal-text' : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
            )}
          >
            <span className="truncate font-medium">{group}</span>
            <span className="shrink-0 text-[11px] tabular-nums">{groupedModels[group].length}</span>
          </button>
        ))}
      </div>
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface">
        {!mobile && (
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-4">
            <span className="truncate text-xs font-semibold text-foreground">{resolvedGroup}</span>
            <span className="text-[11px] tabular-nums text-muted-foreground">{activeModels.length} 个模型</span>
          </div>
        )}
        <div role="list" aria-label={resolvedGroup ? resolvedGroup + ' 模型' : '模型'} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          {activeModels.map(model => (
            <ModelSelectorRow
              key={modelKeyFor(model)}
              model={model}
              selected={isModelSelected(model)}
              favorite={favoriteModelKeys.has(modelKeyFor(model))}
              onSelect={onSelectModel}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
