"use client"
import { Button } from "@/components/ui/button"
import { UserCheck, UserX, Trash2 } from "lucide-react"

type UserBulkActionsBarProps = {
  selectedCount: number
  loading: boolean
  onEnable: () => void
  onDisable: () => void
  onDelete: () => void
  onClear: () => void
}

export function UserBulkActionsBar({
  selectedCount,
  loading,
  onEnable,
  onDisable,
  onDelete,
  onClear,
}: UserBulkActionsBarProps) {
  if (selectedCount === 0) return null

  return (
    <div className="rounded-[10px] border border-primary/20 bg-primary/5 px-4 py-3 sm:px-5 sm:py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm font-medium">
          已选择 {selectedCount} 个用户
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-2">
          <Button size="sm" variant="outline" onClick={onEnable} disabled={loading}>
            <UserCheck className="w-4 h-4 mr-1" />
            批量启用
          </Button>
          <Button size="sm" variant="outline" onClick={onDisable} disabled={loading}>
            <UserX className="w-4 h-4 mr-1" />
            批量禁用
          </Button>
          <Button size="sm" variant="destructive" onClick={onDelete} disabled={loading}>
            <Trash2 className="w-4 h-4 mr-1" />
            批量删除
          </Button>
          <Button size="sm" variant="ghost" onClick={onClear}>
            取消选择
          </Button>
        </div>
      </div>
    </div>
  )
}
