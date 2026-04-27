"use client"

import type { ReactNode } from "react"
import { ChevronDown, Edit3, KeyRound, MoreHorizontal, Server, ShieldAlert, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn, deriveChannelName, formatDate } from "@/lib/utils"
import type { SystemConnectionGroup } from "@/services/system-connections"
import {
  getGroupHealth,
  getModelCount,
  healthLabel,
  providerLabel,
  type EditorFocus,
} from "./view-model"

type SystemConnectionListProps = {
  connections: SystemConnectionGroup[]
  loading: boolean
  expandedGroupId: number | null
  onToggleGroup: (group: SystemConnectionGroup, focus?: EditorFocus) => void
  onOpenGroup: (group: SystemConnectionGroup, focus?: EditorFocus) => void
  onDelete: (id: number) => void
  renderEditor: (group: SystemConnectionGroup) => ReactNode
}

export function SystemConnectionList({
  connections,
  loading,
  expandedGroupId,
  onToggleGroup,
  onOpenGroup,
  onDelete,
  renderEditor,
}: SystemConnectionListProps) {
  if (loading && connections.length === 0) {
    return (
      <section className="v2-panel overflow-hidden bg-white/90 shadow-none">
        <div className="space-y-3 p-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-20 rounded-[8px] bg-slate-100" />
          ))}
        </div>
      </section>
    )
  }

  if (connections.length === 0) {
    return (
      <section className="v2-panel bg-white/90 p-4 shadow-none">
        <div className="rounded-[8px] border border-dashed border-slate-200 bg-slate-50/70 px-4 py-12 text-center text-sm leading-6 text-slate-500">
          暂无匹配连接。可以调整筛选条件，或新增一个 Provider 端点和 API Key。
        </div>
      </section>
    )
  }

  return (
    <section className="v2-panel overflow-hidden bg-white/92 shadow-none">
      <div className="flex items-start gap-3 border-b border-blue-100 bg-blue-50/70 px-4 py-3 text-sm leading-6 text-blue-700">
        <MoreHorizontal className="mt-1 h-4 w-4 shrink-0" />
        <span>连接行默认折叠。点击行尾“展开配置”，即可查看 Key 池、验证结果和高级设置。</span>
      </div>

      <div className="divide-y divide-slate-200/80">
        {connections.map((group) => {
          const expanded = expandedGroupId === group.id
          return (
            <ConnectionRow
              key={group.id}
              group={group}
              expanded={expanded}
              onToggle={() => onToggleGroup(group)}
              onOpen={(focus) => onOpenGroup(group, focus)}
              onDelete={() => onDelete(group.id)}
            >
              {expanded ? renderEditor(group) : null}
            </ConnectionRow>
          )
        })}
      </div>
    </section>
  )
}

function ConnectionRow({
  group,
  expanded,
  onToggle,
  onOpen,
  onDelete,
  children,
}: {
  group: SystemConnectionGroup
  expanded: boolean
  onToggle: () => void
  onOpen: (focus: EditorFocus) => void
  onDelete: () => void
  children: ReactNode
}) {
  const health = getGroupHealth(group)
  const modelCount = getModelCount(group)
  const channelName = deriveChannelName(group.provider, group.baseUrl)
  const tags = group.tags.map((tag) => tag.name).filter(Boolean).slice(0, 3)

  return (
    <article className={cn("bg-white transition-colors", expanded ? "bg-blue-50/30" : "hover:bg-slate-50/70")}>
      <div className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(200px,0.8fr)_auto] lg:items-center">
        <button type="button" onClick={onToggle} className="flex min-w-0 cursor-pointer items-start gap-3 text-left">
          <span
            className={cn(
              "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border",
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
              <span className="truncate text-base font-semibold text-slate-950">{channelName}</span>
              <span className="v2-status">{providerLabel(group)}</span>
              {group.prefixId ? <span className="v2-status">{group.prefixId}</span> : null}
            </span>
            <span className="mt-1 block truncate text-sm text-slate-500">{group.baseUrl}</span>
            {tags.length > 0 ? (
              <span className="mt-2 flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span key={tag} className="rounded-[7px] bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    {tag}
                  </span>
                ))}
              </span>
            ) : null}
          </span>
        </button>

        <div className="grid grid-cols-3 gap-2 text-sm text-slate-500">
          <Metric label="Keys" value={group.apiKeys.length} />
          <Metric label="模型" value={modelCount || "自动"} />
          <Metric label="更新" value={formatDate(group.updatedAt)} />
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Button variant="outline" size="sm" onClick={() => onOpen("advanced")} className="h-9 bg-white">
            <Edit3 className="mr-2 h-4 w-4" />
            编辑
          </Button>
          <Button variant="outline" size="sm" onClick={onDelete} className="h-9 bg-white text-red-600 hover:text-red-700">
            <Trash2 className="mr-2 h-4 w-4" />
            删除
          </Button>
          <Button variant={expanded ? "secondary" : "outline"} size="sm" onClick={onToggle} className="h-9 bg-white">
            <KeyRound className="mr-2 h-4 w-4" />
            {expanded ? "收起" : "展开配置"}
            <ChevronDown className={cn("ml-2 h-4 w-4 transition-transform", expanded && "rotate-180")} />
          </Button>
        </div>
      </div>

      {expanded ? <div className="border-t border-slate-200 bg-slate-50/55 px-4 py-4">{children}</div> : null}
    </article>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 rounded-[8px] bg-slate-50 px-3 py-2">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="mt-0.5 truncate text-sm font-medium text-slate-700">{value}</div>
    </div>
  )
}

