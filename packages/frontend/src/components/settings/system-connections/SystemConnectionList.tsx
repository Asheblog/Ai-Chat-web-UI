"use client"

import { Edit3, MoreHorizontal, Server, ShieldAlert, Trash2 } from "lucide-react"
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
      <section className="v2-panel overflow-hidden shadow-none">
        <div className="space-y-3 p-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-20 rounded-md bg-muted" />
          ))}
        </div>
      </section>
    )
  }

  if (connections.length === 0) {
    return (
      <section className="v2-panel p-4 shadow-none">
        <div className="rounded-md border border-dashed border-border bg-muted/40 px-4 py-12 text-center text-sm leading-6 text-muted-foreground">
          暂无匹配连接。可以调整筛选条件，或新建一个连接。
        </div>
      </section>
    )
  }

  return (
    <section className="v2-panel overflow-hidden bg-background/92 shadow-none">
      <div className="flex items-start gap-3 border-b border-primary/20 bg-primary/5 px-4 py-3 text-sm leading-6 text-primary">
        <MoreHorizontal className="mt-1 h-4 w-4 shrink-0" />
        <span>点击「编辑」打开连接向导，修改显示名称、端点与高级配置。</span>
      </div>

      <div className="divide-y divide-border">
        {connections.map((group) => (
          <ConnectionRow
            key={group.id}
            group={group}
            onEdit={() => onEdit(group)}
            onDelete={() => onDelete(group.id)}
          />
        ))}
      </div>
    </section>
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
    <article className="bg-background transition-colors hover:bg-accent">
      <div className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(250px,0.9fr)_auto] lg:items-center">
        <button type="button" onClick={onEdit} className="flex min-w-0 cursor-pointer items-start gap-3 text-left">
          <span
            className={cn(
              "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md border",
              health === "healthy"
                ? "border-emerald-200 bg-emerald-50 text-emerald-600"
                : health === "warning"
                  ? "border-amber-200 bg-amber-50 text-amber-600"
                  : "border-red-200 bg-red-50 text-red-600",
            )}
            role="img"
            aria-label={healthLabel[health]}
          >
            {health === "error" ? <ShieldAlert className="h-5 w-5" /> : <Server className="h-5 w-5" />}
            <span className="sr-only">{healthLabel[health]}</span>
          </span>
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate text-base font-semibold text-foreground">{group.displayName}</span>
              {group.prefixId ? <span className="v2-status">{group.prefixId}</span> : null}
            </span>
            <span className="mt-1 block truncate text-sm text-muted-foreground">
              {connectionSecondaryLine(group)}
            </span>
            {tags.length > 0 ? (
              <span className="mt-2 flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span key={tag} className="rounded-sm bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {tag}
                  </span>
                ))}
              </span>
            ) : null}
          </span>
        </button>

        <div className="grid grid-cols-3 gap-2 text-sm text-muted-foreground">
          <Metric label="Keys" value={group.apiKeys.length} />
          <Metric label="模型" value={modelCount || "自动"} />
          <Metric label="更新" value={formatDate(group.updatedAt)} />
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Button variant="outline" size="sm" onClick={onEdit} className="h-9 bg-background">
            <Edit3 className="mr-2 h-4 w-4" />
            编辑
          </Button>
          <Button variant="outline" size="sm" onClick={onDelete} className="h-9 bg-background text-destructive hover:text-destructive/80">
            <Trash2 className="mr-2 h-4 w-4" />
            删除
          </Button>
        </div>
      </div>
    </article>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-[4.5rem] rounded-md bg-muted px-3 py-2">
      <div className="text-micro text-muted-foreground/70">{label}</div>
      <div className="mt-0.5 truncate text-sm font-medium text-foreground/80">{value}</div>
    </div>
  )
}
