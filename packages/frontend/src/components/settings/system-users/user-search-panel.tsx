"use client"
import { RefreshCw, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card } from "@/components/ui/card"
import { STATUS_OPTIONS, type StatusFilter } from "./constants"

type UserSearchPanelProps = {
  searchDraft: string
  setSearchDraft: (value: string) => void
  search: string
  loading: boolean
  statusFilter: StatusFilter
  onSearch: () => void
  onClearSearch: () => void
  onStatusFilterChange: (value: StatusFilter) => void
  onRefresh: () => void
}

export function UserSearchPanel({
  searchDraft,
  setSearchDraft,
  search,
  loading,
  statusFilter,
  onSearch,
  onClearSearch,
  onStatusFilterChange,
  onRefresh,
}: UserSearchPanelProps) {
  return (
    <Card className="px-4 py-4 sm:px-5 sm:py-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="搜索用户名..."
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              className="pl-9"
              onKeyDown={(e) => { if (e.key === 'Enter') onSearch() }}
            />
          </div>
          <Button variant="default" onClick={onSearch} disabled={loading} className="w-full sm:w-auto">
            搜索
          </Button>
          {search && (
            <Button variant="ghost" onClick={onClearSearch} disabled={loading} className="w-full sm:w-auto">
              <X className="w-4 h-4 mr-1" />
              清空
            </Button>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <Select value={statusFilter} onValueChange={(value) => onStatusFilterChange(value as StatusFilter)}>
            <SelectTrigger className="w-full sm:w-[140px]">
              <SelectValue placeholder="状态筛选" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={onRefresh} disabled={loading} className="w-full sm:w-auto">
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>
      </div>
    </Card>
  )
}
