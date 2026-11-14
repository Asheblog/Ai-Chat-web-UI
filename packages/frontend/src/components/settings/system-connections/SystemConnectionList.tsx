"use client"

import { Edit3, Server, ShieldAlert, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn, formatDate } from "@/lib/utils"
import type { SystemConnectionGroup } from "@/services/system-connections"
import {
  connectionSecondaryLine,
  getGroupHealth,
  getModelCount,
  healthLabel,
} from "./view-model"

type SystemConnectionListProps = {
  connections: SystemConnectionGroup[]
  loading: boolean
  onEdit: (group: SystemConnectionGroup) => void
  onDelete: (id: number) => void
}

export function SystemConnectionList({
  connections,
  loading,
  onEdit,
  onDelete,
}: SystemConnectionListProps) {
  if (loading && connections.length === 0) {
    return (
      <ul aria-busy="true" aria-label="连接列表" className="divide-y divide-border/70">
        {Array.from({ length: 3 }).map((_, index) => (
          <li key={index} className="h-16 animate-pulse bg-surface-subtle" />
        ))}
      </ul>
    )
  }

  if (connections.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        暂无连接，可在上方「快速接入」选择供应商新建。
      </p>
    )
  }

  return (
    <ul aria-label="连接列表" className="divide-y divide-border/70">
      {connections.map((group) => (
        <ConnectionRow
          key={group.id}
          group={group}
          onEdit={() => onEdit(group)}
          onDelete={() => onDelete(group.id)}
        />
      ))}
    </ul>
  )
}

function ConnectionRow({
  group,
  onEdit,
  onDelete,
}: {
  group: SystemConnectionGroup
  onEdit: () => void
  onDelete: () => void
}) {
  const health = getGroupHealth(group)
  const modelCount = getModelCount(group)
  const tags = group.tags.map((tag) => tag.name).filter(Boolean).slice(0, 3)

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 transition-colors hover:bg-surface-hover">
      <button
        type="button"
        onClick={onEdit}
        className="flex min-w-0 max-w-full flex-1 basis-56 cursor-pointer items-center gap-3 text-left"
      >
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border",
            health === "healthy"
              ? "border-success/30 bg-success/10 text-success"
              : health === "warning"
                ? "border-warning/30 bg-warning/10 text-warning"
                : "border-destructive/30 bg-destructive/10 text-destructive",
          )}
          role="img"
          aria-label={healthLabel[health]}
        >
          {health === "error" ? (
            <ShieldAlert aria-hidden className="h-4 w-4" />
          ) : (
            <Server aria-hidden className="h-4 w-4" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 text-sm font-semibold text-foreground [overflow-wrap:anywhere]">{group.displayName}</span>
            {group.prefixId ? <span className="v2-status min-w-0 max-w-full whitespace-normal [overflow-wrap:anywhere]">{group.prefixId}</span> : null}
            {tags.length > 0
              ? tags.map((tag) => (
                  <span key={tag} className="min-w-0 max-w-full text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    #{tag}
                  </span>
                ))
              : null}
          </span>
          <span className="mt-0.5 block text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
            {connectionSecondaryLine(group)}
          </span>
        </span>
      </button>

      <div className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>Keys {group.apiKeys.length}</span>
          <span aria-hidden className="text-ink-tertiary">
            ·
          </span>
          <span>模型 {modelCount || "自动"}</span>
          <span aria-hidden className="text-ink-tertiary">
            ·
          </span>
          <span>更新 {formatDate(group.updatedAt)}</span>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Edit3 aria-hidden className="mr-1.5 h-4 w-4" />
            编辑
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 aria-hidden className="mr-1.5 h-4 w-4" />
            删除
          </Button>
        </div>
      </div>
    </li>
  )
}
