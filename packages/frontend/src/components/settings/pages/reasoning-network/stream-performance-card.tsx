"use client"

import { Zap } from "lucide-react"
import { Input } from "@/components/ui/input"
import { FeatureCard } from "@/components/settings/components/feature-card"
import { SettingRow } from "@/components/settings/components/setting-row"

export interface StreamPerformanceCardProps {
  streamDeltaChunkSize: number
  onStreamDeltaChunkSizeChange: (v: number) => void
  streamDeltaFlushIntervalMs: string
  onStreamDeltaFlushIntervalMsChange: (v: string) => void
  streamReasoningFlushIntervalMs: string
  onStreamReasoningFlushIntervalMsChange: (v: string) => void
}

/**
 * 流式与传输卡：正文与推理共用默认刷新节奏，推理通道缺省继承正文。
 * 传输保活（streamKeepaliveIntervalMs、推理保活提示）不是常用选项：
 * 前者由代理/SSE 心跳承担，控件先不下发，值原样保留在设置里。
 */
export function StreamPerformanceCard({
  streamDeltaChunkSize,
  onStreamDeltaChunkSizeChange,
  streamDeltaFlushIntervalMs,
  onStreamDeltaFlushIntervalMsChange,
  streamReasoningFlushIntervalMs,
  onStreamReasoningFlushIntervalMsChange,
}: StreamPerformanceCardProps) {
  return (
    <FeatureCard
      icon={Zap}
      title="流式与传输"
      description="流式输出的聚合与刷新节奏；传输保活由 SSE 心跳与反向代理承担"
      cardKey="reasoning-network:stream"
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
            description="留空继承正文节奏；0 表示仅当标签闭合时推送（范围 0-3600000 ms）"
          >
            <Input
              type="text"
              placeholder="1000"
              value={streamReasoningFlushIntervalMs}
              onChange={(e) => onStreamReasoningFlushIntervalMsChange(e.target.value)}
              className="w-full sm:w-32 text-right"
            />
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
