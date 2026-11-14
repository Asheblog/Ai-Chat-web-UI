export const dynamic = 'force-dynamic'

import { TaskTraceConsole } from "@/components/task-trace/TaskTraceConsole"
import { FileText } from "lucide-react"

export default function TaskTraceLogsPage() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        <div className="border-b border-border pb-5">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground">
              <FileText className="h-5 w-5" />
            </span>
            <div className="space-y-1">
              <h1 className="text-title-l font-semibold tracking-tight">任务追踪日志</h1>
              <p className="text-sm text-muted-foreground">
              查看、导出和管理后台 Task Trace 记录，用于性能诊断和问题排查
              </p>
            </div>
          </div>
        </div>
        <TaskTraceConsole />
      </div>
    </div>
  )
}
