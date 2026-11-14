"use client"

import { useState } from "react"
import { FileText, ScrollText, TerminalSquare } from "lucide-react"
import { cn } from "@/lib/utils"
import { SystemLogsPage } from "@/components/settings/pages/SystemLogsPage"
import { TaskTraceConsole } from "@/components/task-trace/TaskTraceConsole"

type LogTab = "system-logs" | "task-trace"

const LOG_TABS: { key: LogTab; label: string; icon: typeof ScrollText; description: string }[] = [
  {
    key: "system-logs",
    label: "运行日志",
    icon: TerminalSquare,
    description: "查看后端服务运行日志，按级别、模块与关键字检索，用于监控和排障。",
  },
  {
    key: "task-trace",
    label: "任务追踪",
    icon: FileText,
    description: "查看、导出和管理后台 Task Trace 记录，用于性能诊断和问题排查。",
  },
]

export function LogViewerPage() {
  const [activeTab, setActiveTab] = useState<LogTab>("system-logs")

  const activeTabDef = LOG_TABS.find((t) => t.key === activeTab) || LOG_TABS[0]
  const ActiveIcon = activeTabDef.icon

  return (
    <div className="min-w-0 space-y-4">
      {/* 头部横幅 */}
      <section className="overflow-hidden rounded-lg border border-border bg-surface p-5">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-signal/30 bg-signal-soft text-signal-text">
            <ActiveIcon className="h-5 w-5" />
          </span>
          <div className="space-y-1">
            <h1 className="text-[22px] font-bold tracking-[-0.3px] text-foreground">{activeTabDef.label}</h1>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-tertiary">{activeTabDef.description}</p>
          </div>
        </div>
      </section>

      {/* Tab 切换 */}
      <div className="flex flex-wrap gap-2">
        {LOG_TABS.map((tab) => {
          const Icon = tab.icon
          const active = tab.key === activeTab
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "inline-flex min-h-9 items-center gap-2 rounded-md border px-4 text-sm font-medium transition-colors",
                active
                  ? "border-border bg-surface font-medium text-foreground"
                  : "border-border bg-surface text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* 内容区域 */}
      {activeTab === "system-logs" && <SystemLogsPage />}
      {activeTab === "task-trace" && <TaskTraceConsole />}
    </div>
  )
}

export default LogViewerPage
