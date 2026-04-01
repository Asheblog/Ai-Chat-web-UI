"use client"

import { useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ChevronDown } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { VerifyConnectionResult } from "@/services/system-connections"
import { cn } from "@/lib/utils"

type SystemConnectionVerifyPanelProps = {
  verifyResult: VerifyConnectionResult | null
  reducedMotion: boolean
}

export function SystemConnectionVerifyPanel({
  verifyResult,
  reducedMotion,
}: SystemConnectionVerifyPanelProps) {
  const [expandedVerifyKey, setExpandedVerifyKey] = useState<string | null>(null)
  const resultKeys = useMemo(
    () =>
      (verifyResult?.results ?? []).map((item, index) => ({
        key: String(item.id || `${item.apiKeyLabel || "key"}-${index}`),
        item,
      })),
    [verifyResult],
  )

  useEffect(() => {
    if (!verifyResult) {
      setExpandedVerifyKey(null)
      return
    }

    const firstFailure = resultKeys.find(({ item }) => !item.success)
    setExpandedVerifyKey(firstFailure?.key ?? null)
  }, [resultKeys, verifyResult])

  return (
    <Card className="border-border/80 bg-card/95 shadow-none">
      <CardContent className="space-y-3 pt-5">
        <h3 className="text-sm font-semibold tracking-tight">验证结果</h3>
        {!verifyResult ? (
          <div className="rounded-2xl border border-dashed border-border/70 bg-[hsl(var(--surface))/0.26] px-4 py-4 text-sm text-muted-foreground">
            还没有验证结果。
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="rounded-full border border-border/70 bg-[hsl(var(--surface))/0.26] px-3 py-1.5">
                成功 {verifyResult.successCount}
              </span>
              <span className="rounded-full border border-border/70 bg-[hsl(var(--surface))/0.26] px-3 py-1.5">
                失败 {verifyResult.failureCount}
              </span>
              <span className="rounded-full border border-border/70 bg-[hsl(var(--surface))/0.26] px-3 py-1.5">
                模型 {verifyResult.totalModels}
              </span>
            </div>

            <div className="space-y-3">
              {resultKeys.map(({ item, key: resultKey }, index) => {
                const expanded = expandedVerifyKey === resultKey
                return (
                  <div key={resultKey} className="rounded-2xl border border-border/70 bg-[hsl(var(--surface))/0.32]">
                    <button
                      type="button"
                      className="flex w-full cursor-pointer items-start justify-between gap-4 px-4 py-4 text-left transition-colors hover:bg-[hsl(var(--surface-hover))/0.45]"
                      onClick={() => setExpandedVerifyKey(expanded ? null : resultKey)}
                    >
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={item.success ? "default" : "destructive"}
                            className={cn("rounded-full px-2.5 py-1", item.success ? "bg-emerald-600 hover:bg-emerald-600" : "")}
                          >
                            {item.success ? "成功" : "失败"}
                          </Badge>
                          <span className="font-medium">{item.apiKeyLabel || `Key ${index + 1}`}</span>
                          <span className="text-xs text-muted-foreground">
                            {item.apiKeyMasked || (item.hasStoredApiKey ? "已保存 Key" : "未填写 Key")}
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {item.success ? `模型 ${item.models.length} 个${item.warning ? "，带告警" : ""}` : item.error || "验证失败"}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <span>{expanded ? "收起" : item.success ? "查看" : "查看详情"}</span>
                        <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
                      </div>
                    </button>

                    <AnimatePresence initial={false}>
                      {expanded ? (
                        <motion.div
                          initial={reducedMotion ? false : { opacity: 0, height: 0 }}
                          animate={reducedMotion ? undefined : { opacity: 1, height: "auto" }}
                          exit={reducedMotion ? undefined : { opacity: 0, height: 0 }}
                          transition={{ duration: 0.2, ease: "easeOut" }}
                          className="overflow-hidden border-t border-border/70"
                        >
                          {!item.success ? (
                            <div className="space-y-3 px-4 py-4">
                              <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4">
                                <div className="text-xs font-medium text-destructive">错误详情</div>
                                <div className="mt-2 break-words text-sm text-foreground">{item.error || "验证失败"}</div>
                              </div>
                              {item.warning ? (
                                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-700">
                                  {item.warning}
                                </div>
                              ) : null}
                            </div>
                          ) : item.models.length === 0 ? (
                            <div className="px-4 py-4 text-sm text-muted-foreground">
                              {item.warning ? <div className="mb-3 text-amber-600">{item.warning}</div> : null}
                              没有返回模型列表。若上游不支持 <span className="font-mono">/models</span>，请直接在该 Key 下填写 Model IDs。
                            </div>
                          ) : (
                            <div className="overflow-auto px-4 py-4">
                              {item.warning ? <div className="mb-3 text-sm text-amber-600">{item.warning}</div> : null}
                              <Table className="min-w-[720px]">
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Model ID</TableHead>
                                    <TableHead>Provider</TableHead>
                                    <TableHead>Channel</TableHead>
                                    <TableHead>Tags</TableHead>
                                    <TableHead>Capabilities</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {item.models.map((model) => {
                                    const tags = (model.tags ?? []).map((tag) => tag?.name).filter(Boolean).join(", ")
                                    const caps = model.capabilities
                                      ? Object.entries(model.capabilities)
                                          .filter(([, value]) => value === true)
                                          .map(([name]) => name)
                                          .join(", ")
                                      : ""
                                    return (
                                      <TableRow key={model.id}>
                                        <TableCell className="font-mono text-xs whitespace-normal break-all">{model.id}</TableCell>
                                        <TableCell className="text-xs">{model.provider}</TableCell>
                                        <TableCell className="text-xs whitespace-normal break-words">{model.channelName || "-"}</TableCell>
                                        <TableCell className="text-xs whitespace-normal break-words">{tags || "-"}</TableCell>
                                        <TableCell className="text-xs whitespace-normal break-words">{caps || "-"}</TableCell>
                                      </TableRow>
                                    )
                                  })}
                                </TableBody>
                              </Table>
                            </div>
                          )}
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
