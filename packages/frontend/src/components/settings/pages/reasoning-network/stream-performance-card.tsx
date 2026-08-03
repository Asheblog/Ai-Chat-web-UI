"use client"

import { Zap } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FeatureCard } from "@/components/settings/components/feature-card"
import { SettingRow } from "@/components/settings/components/setting-row"

export type ReasoningEffort = 'unset' | 'low' | 'medium' | 'high' | 'max' | 'xhigh'

export interface StreamPerformanceCardProps {
  streamDeltaChunkSize: number
  onStreamDeltaChunkSizeChange: (v: number) => void
  streamDeltaFlushIntervalMs: string
  onStreamDeltaFlushIntervalMsChange: (v: string) => void
  streamReasoningFlushIntervalMs: string
  onStreamReasoningFlushIntervalMsChange: (v: string) => void
  streamKeepaliveIntervalMs: string
  onStreamKeepaliveIntervalMsChange: (v: string) => void
  openaiReasoningEffort: ReasoningEffort
  onOpenaiReasoningEffortChange: (v: ReasoningEffort) => void
}

/**
 * 流式与性能卡：5 行全部位于「更多参数」折叠区（源 SystemReasoning 分片/flush/keepalive/reasoning_effort 行）。
 */
export function StreamPerformanceCard({
  streamDeltaChunkSize,
  onStreamDeltaChunkSizeChange,
  streamDeltaFlushIntervalMs,
  onStreamDeltaFlushIntervalMsChange,
  streamReasoningFlushIntervalMs,
  onStreamReasoningFlushIntervalMsChange,
  streamKeepaliveIntervalMs,
  onStreamKeepaliveIntervalMsChange,
  openaiReasoningEffort,
  onOpenaiReasoningEffortChange,
}: StreamPerformanceCardProps) {
  return (
    <FeatureCard
      icon={Zap}
      title="流式与性能"
      description="控制流式输出的分片、刷新与 keepalive 节奏"
      moreLabel="更多参数"
      more={
        <>
          <SettingRow
            title="流式增量聚合（分片大小）"
            description="越大则刷新更平滑但延迟稍增（范围 1-100）"
          >
            <Input
              id="deltaSize"
              type="text"
              value={streamDeltaChunkSize}
              onChange={(e) => onStreamDeltaChunkSizeChange(parseDeltaChunkSize(e.target.value, streamDeltaChunkSize))}
              className="w-full sm:w-32 text-right"
            />
          </SettingRow>

          <SettingRow
            title="正文 flush 间隔（毫秒）"
            description="推荐 800ms；0 表示仅按分片大小触发（范围 0-3600000 ms）"
          >
            <Input
              type="text"
              placeholder="800"
              value={streamDeltaFlushIntervalMs}
              onChange={(e) => onStreamDeltaFlushIntervalMsChange(e.target.value)}
              className="w-full sm:w-32 text-right"
            />
          </SettingRow>

          <SettingRow
            title="推理 flush 间隔（毫秒）"
            description="推荐 1000ms；0 表示仅当标签闭合时推送（范围 0-3600000 ms）"
          >
            <Input
              type="text"
              placeholder="1000"
              value={streamReasoningFlushIntervalMs}
              onChange={(e) => onStreamReasoningFlushIntervalMsChange(e.target.value)}
              className="w-full sm:w-32 text-right"
            />
          </SettingRow>

          <SettingRow
            title="Keepalive 间隔（毫秒）"
            description="推荐 5000ms；0 表示仅在推理 keepalive 触发（范围 0-3600000 ms）"
          >
            <Input
              type="text"
              placeholder="5000"
              value={streamKeepaliveIntervalMs}
              onChange={(e) => onStreamKeepaliveIntervalMsChange(e.target.value)}
              className="w-full sm:w-32 text-right"
            />
          </SettingRow>

          <SettingRow
            title="OpenAI reasoning_effort"
            description="仅对支持该参数的模型生效"
          >
            <Select
              value={openaiReasoningEffort}
              onValueChange={(v) => onOpenaiReasoningEffortChange(v as ReasoningEffort)}
            >
              <SelectTrigger className="w-full sm:w-[220px]"><SelectValue placeholder="不设置" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">不设置</SelectItem>
                <SelectItem value="low">low</SelectItem>
                <SelectItem value="medium">medium</SelectItem>
                <SelectItem value="high">high</SelectItem>
                <SelectItem value="max">max</SelectItem>
                <SelectItem value="xhigh">xhigh</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
        </>
      }
    />
  )
}

/** 源 SystemReasoning parseDeltaChunkSize：空串 → 1，非法 → 保持原值 */
function parseDeltaChunkSize(value: string, fallback: number) {
  const trimmed = value.trim()
  if (trimmed === '') return 1
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : fallback
}
