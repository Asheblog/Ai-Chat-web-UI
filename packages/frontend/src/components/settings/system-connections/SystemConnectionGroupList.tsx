"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { CheckCircle2, ChevronDown, Edit3, Link2, Loader2, ShieldAlert, Trash2 } from "lucide-react"
import type { SystemConnectionGroup } from "@/services/system-connections"
import { cn, deriveChannelName, formatDate } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type SystemConnectionGroupListProps = {
  connections: SystemConnectionGroup[]
  loading: boolean
  reducedMotion: boolean
  onRefresh: () => void
  onStartEdit: (group: SystemConnectionGroup) => void
  onRequestDelete: (id: number) => void
  renderVendorLabel: (vendor?: string | null) => string | null
}

export function SystemConnectionGroupList({
  connections,
  loading,
  reducedMotion,
  onRefresh,
  onStartEdit,
  onRequestDelete,
  renderVendorLabel,
}: SystemConnectionGroupListProps) {
  const [expandedGroupId, setExpandedGroupId] = useState<number | null>(null)

  useEffect(() => {
    if (connections.length === 0) {
      setExpandedGroupId(null)
      return
    }
    if (expandedGroupId != null && connections.some((group) => group.id === expandedGroupId)) {
      return
    }
    setExpandedGroupId(null)
  }, [connections, expandedGroupId])

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h3 className="text-xl font-semibold tracking-tight">已配置端点</h3>
          <p className="text-sm text-muted-foreground">查看、编辑或删除现有端点组。</p>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading} className="min-h-11">
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          刷新
        </Button>
      </div>

      {loading && connections.length === 0 ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="rounded-[26px] border border-border/70 bg-card/80 px-5 py-5">
              <div className="h-4 w-52 rounded bg-muted" />
              <div className="mt-3 h-3 w-72 rounded bg-muted/70" />
              <div className="mt-5 h-24 rounded-2xl bg-muted/50" />
            </div>
          ))}
        </div>
      ) : null}

      {!loading && connections.length === 0 ? (
        <div className="rounded-[26px] border border-dashed border-border/70 bg-card/70 px-6 py-12 text-center text-sm leading-6 text-muted-foreground">
          暂无端点配置。先在上面创建一个端点组，再把不同的 Key 作为子项放进去。
        </div>
      ) : null}

      <div className="space-y-4">
        {connections.map((group, index) => {
          const channelLabel = deriveChannelName(group.provider, group.baseUrl)
          const vendorLabel = renderVendorLabel(group.vendor)
          const enabledCount = group.apiKeys.filter((key) => key.enable).length
          const expanded = expandedGroupId === group.id
          return (
            <motion.article
              key={group.id}
              initial={reducedMotion ? false : { opacity: 0, y: 12 }}
              animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
              transition={{ duration: 0.22, delay: reducedMotion ? 0 : index * 0.03, ease: "easeOut" }}
              className="rounded-[28px] border border-border/80 bg-card/95 p-5 shadow-none"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <button
                  type="button"
                  onClick={() => setExpandedGroupId(expanded ? null : group.id)}
                  className="flex min-w-0 flex-1 cursor-pointer items-start justify-between gap-4 text-left"
                >
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="rounded-full px-3 py-1">
                        <Link2 className="mr-1.5 h-3.5 w-3.5" />
                        {channelLabel}
                      </Badge>
                      <Badge variant="outline" className="rounded-full px-3 py-1">
                        {group.provider}
                      </Badge>
                      {vendorLabel ? (
                        <Badge variant="outline" className="rounded-full px-3 py-1">
                          {vendorLabel}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="text-base font-semibold break-all">{group.baseUrl}</div>
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span className="rounded-full bg-muted px-3 py-1">{group.apiKeys.length} Keys</span>
                      <span className="rounded-full bg-muted px-3 py-1">启用 {enabledCount}</span>
                      <span className="rounded-full bg-muted px-3 py-1">{group.authType}</span>
                      <span className="rounded-full bg-muted px-3 py-1">{group.connectionType}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">更新于 {formatDate(group.updatedAt)}</div>
                  </div>
                  <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />
                </button>

                <div className="flex gap-2 self-start">
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-10"
                    onClick={() => onStartEdit(group)}
                    aria-label={`编辑 ${group.baseUrl}`}
                  >
                    <Edit3 className="mr-2 h-4 w-4" />
                    编辑
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="min-h-10"
                    onClick={() => onRequestDelete(group.id)}
                    aria-label={`删除 ${group.baseUrl}`}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    删除
                  </Button>
                </div>
              </div>

              {expanded ? (
                <div className="mt-4 grid gap-3 border-t border-border/60 pt-4">
                  {group.apiKeys.map((key) => (
                    <div
                      key={key.id || `${group.id}-${key.apiKeyLabel}`}
                      className="grid gap-3 rounded-2xl border border-border/70 bg-[hsl(var(--surface))/0.34] px-4 py-4 xl:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)_auto]"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          {key.enable ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          ) : (
                            <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                          )}
                          <span>{key.apiKeyLabel || `Key ${key.id}`}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {key.apiKeyMasked || (key.hasStoredApiKey ? "已保存 Key" : "未填写 Key")}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Models</div>
                        {key.modelIds.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {key.modelIds.map((modelId) => (
                              <span
                                key={modelId}
                                className="rounded-full border border-border/70 bg-background/90 px-3 py-1 text-xs"
                              >
                                {modelId}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm text-muted-foreground">未显式限制，默认按这个 Key 从上游自动枚举。</div>
                        )}
                      </div>

                      <div className="flex items-start justify-end">
                        <Badge variant={key.enable ? "default" : "secondary"} className="rounded-full px-3 py-1">
                          {key.enable ? "启用中" : "已停用"}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </motion.article>
          )
        })}
      </div>
    </section>
  )
}
