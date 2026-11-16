"use client"

import { ArrowRight, CheckCircle2, ChevronRight } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { ApiResponse } from "@/types"

/** 统计三态：loading 给骨架，error 说「未知」，ready 才是真数量。 */
export type CountState = { status: "loading" | "ready" | "error"; value: number }

/** 状态徽标沿用 globals.css 的 v2-status 语义类（成功 / 待办 / 未知），不新造配色。 */
const STATUS_BASE = "v2-status"
const STATUS_ON = STATUS_BASE + " v2-status-success"
const STATUS_TODO = STATUS_BASE + " v2-status-warning"
const STATUS_IDLE = STATUS_BASE

/** 从 ApiResponse 信封取数组：请求失败或信封里没有数组都算未知，不静默当 0。 */
export function readList<T>(result: PromiseSettledResult<ApiResponse<T[]>>): T[] | null {
  if (result.status !== "fulfilled") return null
  return Array.isArray(result.value?.data) ? result.value.data : null
}

export function countState(items: readonly unknown[] | null): CountState {
  return items ? { status: "ready", value: items.length } : { status: "error", value: 0 }
}

/** 能力行副信息：加载中给 null（骨架），失败给「— 单位」，0 可换白话说法。 */
export function metaText(count: CountState, unit: string, zeroText?: string): string | null {
  if (count.status === "loading") return null
  if (count.status === "error") return `— ${unit}`
  if (count.value === 0 && zeroText) return zeroText
  return `${count.value} ${unit}`
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
  if (unknown) return { label: "状态未知", tone: STATUS_IDLE }
  return enabled ? { label: onLabel, tone: STATUS_ON } : { label: offLabel, tone: STATUS_IDLE }
}

type CapabilityRowProps = {
  icon: LucideIcon
  title: string
  /** 一行说明：这一项接的是什么东西 */
  description: string
  /** 数量/设置项数；undefined 表示本行没有副信息，null 表示统计加载中 */
  meta?: string | null
  /** null = 设置加载中（渲染骨架）；不传 = 本行没有开关状态 */
  status?: FlagStatus
  onEnter: () => void
}

/**
 * 总览能力行：整行可点（44px 起，移动端也能整行命中），右侧数量与状态集中对齐。
 * 行内不用 heading：一行按钮里塞标题会让读屏把它读成「按钮里的标题」，
 * 标题与说明都作为按钮无障碍名的一部分自然读出。
 */
export function CapabilityRow({
  icon: Icon,
  title,
  description,
  meta,
  status,
  onEnter,
}: CapabilityRowProps) {
  return (
    <button
      type="button"
      onClick={onEnter}
      className="flex min-h-11 w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors duration-[160ms] hover:bg-surface-hover md:flex-row md:items-center md:gap-3 md:py-3.5"
    >
      {/* 手机第一行：图标 + 标题/说明 + 箭头；桌面同一块变成 flex-1 的图标+正文 */}
      <span className="flex w-full min-w-0 items-start gap-2.5 md:w-auto md:flex-1 md:items-center md:gap-3">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-subtle text-ink-tertiary"
          aria-hidden="true"
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">{title}</span>
          <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground text-pretty">
            {description}
          </span>
        </span>
        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-tertiary md:hidden" aria-hidden="true" />
      </span>
      {/* 数量 + 状态：手机在正文下方缩进一行，桌面靠右成一列 */}
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pl-12 md:shrink-0 md:flex-nowrap md:pl-0">
        {meta === undefined ? null : meta === null ? (
          <Skeleton className="h-3.5 w-16" />
        ) : (
          <span className="num-tabular text-[13px] text-muted-foreground">{meta}</span>
        )}
        {status === undefined ? null : status === null ? (
          <Skeleton className="h-5 w-14 rounded-full" />
        ) : (
          <span className={status.tone}>{status.label}</span>
        )}
        <ChevronRight className="hidden h-4 w-4 shrink-0 text-ink-tertiary md:block" aria-hidden="true" />
      </span>
    </button>
  )
}

export type PendingRowProps = {
  text: string
  /** 统计失败时给「—」与禁用的入口；加载中由面板骨架承担，不走这一行 */
  state: Extract<CountState["status"], "ready" | "error">
  onHandle: () => void
}

/** 真实待办行：只渲染确实要处理的项（数量 > 0 或状态未知），零态收敛到 PendingEmpty。 */
export function PendingRow({ text, state, onHandle }: PendingRowProps) {
  const actionable = state === "ready"

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 last:border-b-0">
      <span className="text-sm font-medium text-foreground">{text}</span>
      {state === "error" ? (
        <span className={STATUS_IDLE}>—</span>
      ) : (
        <span className={STATUS_TODO}>待处理</span>
      )}
      <span className="ml-auto flex items-center gap-2">
        {state === "error" ? <span className="v2-muted-line">状态未知</span> : null}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="min-h-11 gap-1 md:min-h-0"
          onClick={onHandle}
          disabled={!actionable}
          aria-label={`${text}：去处理`}
        >
          去处理
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </span>
    </li>
  )
}

/** 无待办空态：一条结果，不再逐条渲染「没有待审批」「都已绑定」这类零态行。 */
export function PendingEmpty() {
  return (
    <div className="flex items-start gap-2.5 px-4 py-4">
      <CheckCircle2
        className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--success))]"
        aria-hidden="true"
      />
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-semibold text-foreground">当前没有待审批调用</p>
        <p className="text-[13px] text-muted-foreground text-pretty">
          有待你决定的 Skill 调用时会出现在这里。
        </p>
      </div>
    </div>
  )
}
