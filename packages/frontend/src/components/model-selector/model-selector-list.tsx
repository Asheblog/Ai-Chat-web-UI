import type { ModelItem } from '@/store/models-store'
import { modelKeyFor } from '@/store/model-preference-store'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { ModelSelectorRow } from './model-selector-row'

interface ModelSelectorListProps {
  loading: boolean
  models: ModelItem[]
  isModelSelected: (model: ModelItem) => boolean
  onSelectModel: (model: ModelItem) => void
  hasSearch: boolean
  onRefresh: () => void
}

export function ModelSelectorList({ loading, models, isModelSelected, onSelectModel, hasSearch, onRefresh }: ModelSelectorListProps) {
  if (loading) {
    return (
      <div role="status" aria-label="正在加载模型" className="min-h-0 flex-1 space-y-1 overflow-hidden px-2 pb-2">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="rounded-lg px-3 py-3">
            <Skeleton className="h-5 w-44 max-w-full" />
            <Skeleton className="mt-1 h-4 w-28" />
          </div>
        ))}
      </div>
    )
  }
  if (!models.length) {
    return (
      <div role="status" className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <p className="text-sm font-medium text-foreground">{hasSearch ? '没有找到匹配模型' : '暂无可用模型'}</p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{hasSearch ? '试试模型名，或搜索供应商。' : '添加模型连接后，即可在这里选择。'}</p>
        {!hasSearch && <Button type="button" variant="outline" className="mt-4 h-11" onClick={onRefresh}>刷新模型目录</Button>}
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-5 pb-2 pt-1 text-xs leading-4 text-muted-foreground">{hasSearch ? '搜索结果' : '全部模型'}</div>
      <ul aria-label="全部模型" className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-2 pb-2">
        {models.map(model => <ModelSelectorRow key={modelKeyFor(model)} model={model} selected={isModelSelected(model)} onSelect={onSelectModel} />)}
      </ul>
    </div>
  )
}
