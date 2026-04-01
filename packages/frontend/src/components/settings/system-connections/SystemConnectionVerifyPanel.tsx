"use client"

import { useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ChevronDown } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
      <CardHeader className="space-y-2">
        <CardTitle className="text-lg">验证结果</CardTitle>
        <CardDescription>
          每个 Key 单独返回状态、错误信息和模型列表，不再只有一个总结果。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!verifyResult ? (
          <div className="rounded-2xl border border-dashed border-border/70 bg-[hsl(var(--surface))/0.32] px-4 py-6 text-sm leading-6 text-muted-foreground">
            还没有验证结果。点击“并发验证全部 Key”后，这里会展示每个 Key 的成功/失败、告警和模型数。
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-border/70 bg-[hsl(var(--surface))/0.38] px-4 py-3">
                <div className="text-xs text-muted-foreground">成功</div>
                <div className="mt-1 text-xl font-semibold">{verifyResult.successCount}</div>
              </div>
              <div className="rounded-2xl border border-border/70 bg-[hsl(var(--surface))/0.38] px-4 py-3">
                <div className="text-xs text-muted-foreground">失败</div>
                <div className="mt-1 text-xl font-semibold">{verifyResult.failureCount}</div>
              </div>
              <div className="rounded-2xl border border-border/70 bg-[hsl(var(--surface))/0.38] px-4 py-3">
                <div className="text-xs text-muted-foreground">总模型数</div>
                <div className="mt-1 text-xl font-semibold">{verifyResult.totalModels}</div>
              </div>
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
