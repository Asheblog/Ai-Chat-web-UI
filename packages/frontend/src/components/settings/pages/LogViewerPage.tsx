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
      <section className="overflow-hidden rounded-2xl border border-border/80 bg-[linear-gradient(135deg,hsl(var(--surface))/0.95,hsl(var(--background-alt))/0.72)] p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
            <ActiveIcon className="h-5 w-5" />
          </span>
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">{activeTabDef.label}日志</h1>
            <p className="text-sm text-muted-foreground">{activeTabDef.description}</p>
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
                "inline-flex min-h-9 items-center gap-2 rounded-[8px] border px-4 text-sm font-medium transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground shadow-[0_10px_22px_rgba(37,99,235,0.18)]"
                  : "border-slate-200 bg-white/80 text-slate-600 hover:bg-blue-50 hover:text-slate-950",
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
