import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Search } from 'lucide-react'
import type { FC } from 'react'

type Props = {
  sessionFilter: string
  keyword: string
  status: string
  onSessionFilterChange: (value: string) => void
  onKeywordChange: (value: string) => void
  onStatusChange: (value: string) => void
  onSearch: () => void
  onReset: () => void
}

export const TaskTraceFilters: FC<Props> = ({
  sessionFilter,
  keyword,
  status,
  onSessionFilterChange,
  onKeywordChange,
  onStatusChange,
  onSearch,
  onReset,
}) => (
  <Card className="px-5 py-5">
    <div className="flex flex-col gap-3 md:flex-row md:items-end">
      <div className="flex-1 space-y-1">
        <label className="text-sm text-muted-foreground" htmlFor="sessionFilter">
          会话 ID
        </label>
        <Input
          id="sessionFilter"
          value={sessionFilter}
          onChange={(e) => onSessionFilterChange(e.target.value)}
          placeholder="输入数字 ID"
        />
      </div>
      <div className="flex-1 space-y-1">
        <label className="text-sm text-muted-foreground" htmlFor="keyword">
          关键字
        </label>
        <Input
          id="keyword"
          value={keyword}
          onChange={(e) => onKeywordChange(e.target.value)}
          placeholder="支持 Actor / Client ID"
        />
      </div>
      <div className="w-full space-y-1 md:w-48">
        <label className="text-sm text-muted-foreground">状态</label>
        <Select
          value={status || undefined}
          onValueChange={(value) => onStatusChange(value === '__all' ? '' : value)}
        >
          <SelectTrigger>
            <SelectValue placeholder="全部" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">全部</SelectItem>
            <SelectItem value="running">进行中</SelectItem>
            <SelectItem value="completed">已完成</SelectItem>
            <SelectItem value="error">失败</SelectItem>
            <SelectItem value="cancelled">已取消</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-2">
        <Button className="flex items-center gap-2" onClick={onSearch}>
          <Search className="h-4 w-4" />
          搜索
        </Button>
        <Button variant="outline" onClick={onReset}>
          重置
        </Button>
      </div>
    </div>
  </Card>
)
