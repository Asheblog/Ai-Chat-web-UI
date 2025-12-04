"use client"

import { useState } from "react"
import type { MessageMeta, ToolEvent } from "@/types"
import type { ToolTimelineSummary } from "@/features/chat/tool-events/useToolTimeline"
import { ToolTimeline } from "./tool-timeline"

/**
 * 手动 story：供 Storybook 或其他可视化环境渲染 ToolTimeline。
 * 在没有 Storybook 的情况下，可直接在任意页面引入 <ToolTimelineStory /> 做 UI 校验。
 */

const sampleMeta: MessageMeta = {
  id: 301,
  sessionId: 1,
  stableKey: "msg:301",
  role: "assistant",
  createdAt: new Date("2024-10-01T12:00:00Z").toISOString(),
  reasoningStatus: "done",
  reasoningDurationSeconds: 12,
  reasoningIdleMs: 800,
}

const sampleTimeline: ToolEvent[] = [
  {
    id: "tool-start",
    sessionId: 1,
    messageId: 301,
    tool: "web_search",
    stage: "start",
    status: "running",
    createdAt: Date.now(),
    query: "最新 AI 芯片",
  },
  {
    id: "tool-result",
    sessionId: 1,
    messageId: 301,
    tool: "web_search",
    stage: "result",
    status: "success",
    createdAt: Date.now() + 800,
    hits: [
      { title: "TechNews", url: "https://example.com/news/1", snippet: "芯片发布..." },
    ],
    summary: "返回 3 条候选链接",
  },
  {
    id: "python-error",
    sessionId: 1,
    messageId: 301,
    tool: "python_runner",
    stage: "error",
    status: "error",
    createdAt: Date.now() + 1200,
    error: "执行超时",
    details: { stderr: "Timeout" },
  },
]

const sampleSummary: ToolTimelineSummary = {
  total: sampleTimeline.length,
  summaryText: "完成 1 次 · 进行中 1 次 · 失败 1 次",
  label: "联网搜索 2 次 / Python 工具 1 次",
}

const storyMeta = {
  title: "MessageBubble/ToolTimeline",
}

export default storyMeta

export function ToolTimelineStory() {
  const [expanded, setExpanded] = useState(true)
  return (
    <div className="w-full max-w-3xl mx-auto bg-background text-foreground p-6 border rounded-lg">
      <ToolTimeline
        meta={sampleMeta}
        reasoningRaw="进行联网搜索并尝试用 Python 工具生成图表。"
        reasoningHtml="<p>进行联网搜索并尝试用 Python 工具生成图表。</p>"
        summary={sampleSummary}
        timeline={sampleTimeline}
        expanded={expanded}
        onToggle={() => setExpanded((prev) => !prev)}
      />
    </div>
  )
}
