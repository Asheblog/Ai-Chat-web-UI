import { AlertCircle, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ModelSelectorHeaderProps {
  count: number
  connections: number
  loading: boolean
  error: string | null
  hasModels: boolean
  onRefresh: () => void
  onClose: () => void
}

export function ModelSelectorHeader({ count, connections, loading, error, hasModels, onRefresh, onClose }: ModelSelectorHeaderProps) {
  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="text-base font-semibold leading-6 text-foreground">选择模型</div>
          <div className="text-xs leading-5 text-muted-foreground">
            {count} 个模型{connections > 0 ? ' · ' + connections + ' 个连接' : ''}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" variant="ghost" size="icon" className="h-11 w-11 rounded-lg text-muted-foreground md:h-9 md:w-9" onClick={onRefresh} disabled={loading} aria-label="刷新模型目录">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin motion-reduce:animate-none')} />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-11 w-11 rounded-lg text-muted-foreground md:h-9 md:w-9" onClick={onClose} aria-label="关闭模型选择器">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {error && (
        <div role="alert" className="flex shrink-0 items-start gap-2 border-b border-border bg-surface-subtle px-4 py-3 text-sm text-foreground">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">{hasModels ? '刷新模型目录失败，仍可使用已加载的模型' : '模型目录加载失败'}</div>
            <p className="mt-1 break-words text-xs text-muted-foreground">{error}</p>
          </div>
          <Button type="button" variant="outline" size="sm" className="h-11 shrink-0 md:h-8" onClick={onRefresh} disabled={loading}>重试</Button>
        </div>
      )}
    </>
  )
}
