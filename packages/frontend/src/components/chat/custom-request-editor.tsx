import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

export interface CustomRequestEditorProps {
  customHeaders: Array<{ name: string; value: string }>
  onAddHeader: () => void
  onHeaderChange: (index: number, field: 'name' | 'value', value: string) => void
  onRemoveHeader: (index: number) => void
  customBody: string
  onCustomBodyChange: (value: string) => void
  customBodyError?: string | null
}

export function CustomRequestEditor({
  customHeaders,
  onAddHeader,
  onHeaderChange,
  onRemoveHeader,
  customBody,
  onCustomBodyChange,
  customBodyError,
}: CustomRequestEditorProps) {
  return (
    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
      <div className="rounded-2xl border border-border/60 bg-muted/40 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">自定义请求头</p>
            <p className="text-xs text-muted-foreground">最多 10 条，敏感头将被忽略。</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onAddHeader} aria-label="添加请求头">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {customHeaders.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂未添加请求头，可点击右上角添加。</p>
        ) : (
          <div className="space-y-2">
            {customHeaders.map((item, idx) => (
              <div
                key={`${idx}-${item.name}-${item.value}`}
                className="flex flex-col gap-2 md:flex-row md:items-center"
              >
                <Input
                  value={item.name}
                  onChange={(e) => onHeaderChange(idx, 'name', e.target.value)}
                  placeholder="标头名称"
                  className="h-10 flex-1"
                  data-advanced-input="true"
                />
                <Input
                  value={item.value}
                  onChange={(e) => onHeaderChange(idx, 'value', e.target.value)}
                  placeholder="标头值"
                  className="h-10 flex-1"
                  data-advanced-input="true"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onRemoveHeader(idx)}
                  aria-label="删除请求头"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border/60 bg-muted/40 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">自定义请求体</p>
            <p className="text-xs text-muted-foreground">支持 JSON 对象，将与默认请求合并。</p>
          </div>
        </div>
        <Textarea
          value={customBody}
          onChange={(e) => onCustomBodyChange(e.target.value)}
          placeholder='例如：{"temperature":0.3,"top_p":0.8}'
          className="min-h-[120px] resize-y"
          data-advanced-input="true"
        />
        {customBodyError ? (
          <p className="text-xs text-destructive">{customBodyError}</p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            核心字段（model/messages/stream）已被保护，敏感头会被忽略。
          </p>
        )}
      </div>
    </div>
  )
}
