import { AlertCircle, ChevronLeft, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ModelSelectorView } from './model-selector-types'

interface ModelSelectorHeaderProps {
  view: ModelSelectorView
  title: string
  loading: boolean
  error: string | null
  hasModels: boolean
  onRefresh: () => void
  onClose: () => void
  onBack: () => void
}

export function ModelSelectorHeader({ view, title, loading, error, hasModels, onRefresh, onClose, onBack }: ModelSelectorHeaderProps) {
  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-1 px-2 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {view === 'effort' && (
            <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0 rounded-lg text-muted-foreground md:h-9 md:w-9" onClick={onBack} aria-label="返回模型列表">
              <ChevronLeft aria-hidden="true" className="h-4 w-4" />
            </Button>
          )}
          <h2 className="min-w-0 truncate px-2 text-[15px] font-semibold leading-6 text-foreground">{title}</h2>
        </div>
        <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0 rounded-lg text-muted-foreground md:h-9 md:w-9" onClick={onClose} aria-label="关闭模型选择器">
          <X aria-hidden="true" className="h-4 w-4" />
        </Button>
      </div>
      {error && (
        <div role="alert" className="mx-4 mb-2 flex shrink-0 items-start gap-2 rounded-lg border border-border bg-surface-subtle p-3 text-sm text-foreground">
          <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">{hasModels ? '刷新失败，仍可选择已加载的模型' : '模型目录加载失败'}</div>
            <p className="mt-1 break-words text-xs text-muted-foreground">{error}</p>
          </div>
          <Button type="button" variant="outline" size="sm" className="h-11 shrink-0 md:h-8" onClick={onRefresh} disabled={loading}>重试</Button>
        </div>
      )}
    </>
  )
}
