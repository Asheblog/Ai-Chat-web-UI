"use client"

import { ArrowRight } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { ApiResponse } from "@/types"

export type CountState = { status: "loading" | "ready" | "error"; value: number }

/** 状态配色沿用 globals.css 的 --success / --warning 语义色，不新造配色。 */
const TONE_ON = "border-[hsl(var(--success)/0.25)] bg-[hsl(var(--success)/0.11)] text-[hsl(var(--success))]"
const TONE_TODO = "border-[hsl(var(--warning)/0.26)] bg-[hsl(var(--warning)/0.11)] text-[hsl(var(--warning))]"
const TONE_IDLE = "border-border bg-surface-subtle text-muted-foreground"

/** 从 ApiResponse 信封取数组：请求失败或信封里没有数组都算未知，不静默当 0。 */
export function readList<T>(result: PromiseSettledResult<ApiResponse<T[]>>): T[] | null {
  if (result.status !== "fulfilled") return null
  return Array.isArray(result.value?.data) ? result.value.data : null
}

export function countState(items: readonly unknown[] | null): CountState {
  return items ? { status: "ready", value: items.length } : { status: "error", value: 0 }
}

/** 卡片副信息：加载中给 null（骨架），失败给「— 单位」，0 可换白话说法。 */
export function metaText(count: CountState, unit: string, zeroText?: string): string | null {
  if (count.status === "loading") return null
  if (count.status === "error") return `— ${unit}`
  if (count.value === 0 && zeroText) return zeroText
  return `${count.value} ${unit}`
}

/** 待处理行文案：数量嵌在句子里，失败时退回不带数字的说法。 */
export function rowText(count: CountState, unit: string, zeroText: string, unknownText: string): string {
  if (count.status !== "ready") return unknownText
  return count.value === 0 ? zeroText : `${count.value} ${unit}`
}

type FlagStatus = { label: string; tone: string } | null

/** 总开关状态徽标；null 表示设置还在加载（渲染骨架）。 */
export function flagStatus(
  loading: boolean,
  unknown: boolean,
  enabled: boolean,
  onLabel: string,
  offLabel: string,
): FlagStatus {
  if (loading) return null
  if (unknown) return { label: "状态未知", tone: TONE_IDLE }
  return enabled ? { label: onLabel, tone: TONE_ON } : { label: offLabel, tone: TONE_IDLE }
}

type PendingStatus =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; label: string; tone: string; actionable: boolean }

export function pendingStatus(count: CountState): PendingStatus {
  if (count.status === "loading") return { state: "loading" }
  if (count.status === "error") return { state: "error" }
  return count.value > 0
    ? { state: "ready", label: "待处理", tone: TONE_TODO, actionable: true }
    : { state: "ready", label: "已就绪", tone: TONE_IDLE, actionable: false }
}

type CapabilityCardProps = {
  icon: LucideIcon
  title: string
  description: string
  /** 补充说明（如 MCP 的五步配置流程），可选 */
  hint?: string
  /** null = 设置加载中 */
  status: FlagStatus
  /** undefined = 本卡无副信息；null = 统计加载中 */
  meta?: string | null
  onEnter: () => void
}

export function CapabilityCard({
  icon: Icon,
  title,
  description,
  hint,
  status,
  meta,
  onEnter,
}: CapabilityCardProps) {
  return (
    <section className="v2-panel flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-subtle text-ink-tertiary">
            <Icon className="h-4 w-4" />
          </span>
          <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
        </div>
        {status ? (
          <Badge className={status.tone}>{status.label}</Badge>
        ) : (
          <Skeleton className="h-5 w-14 shrink-0 rounded-full" />
        )}
      </div>

      <p className="text-sm text-muted-foreground text-pretty">{description}</p>
      {hint ? <p className="v2-muted-line text-xs">{hint}</p> : null}

      <div className="mt-auto flex items-center gap-2 pt-1">
        {meta === undefined ? null : meta === null ? (
          <Skeleton className="h-3.5 w-16" />
        ) : (
          <span className="v2-muted-line">{meta}</span>
        )}
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="ml-auto gap-1"
          onClick={onEnter}
          aria-label={`进入 ${title}`}
        >
          进入
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </section>
  )
}

export function PendingRow({
  text,
  status,
  onHandle,
}: {
  text: string
  status: PendingStatus
  onHandle: () => void
}) {
  const actionable = status.state === "ready" && status.actionable

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 last:border-b-0">
      <span className="text-sm font-medium text-foreground">{text}</span>
      {status.state === "loading" ? (
        <Skeleton className="h-5 w-12 rounded-full" />
      ) : status.state === "error" ? (
        <Badge className={TONE_IDLE}>—</Badge>
      ) : (
        <Badge className={status.tone}>{status.label}</Badge>
      )}
      <span className="ml-auto flex items-center gap-2">
        {status.state === "error" ? <span className="v2-muted-line">状态未知</span> : null}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="gap-1"
          onClick={onHandle}
          disabled={!actionable}
          aria-label={`${text}：去处理`}
        >
          去处理
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </span>
    </li>
  )
}
