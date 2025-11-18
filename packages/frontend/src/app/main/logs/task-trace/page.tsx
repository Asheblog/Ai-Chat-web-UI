export const dynamic = 'force-dynamic'

import { TaskTraceConsole } from "@/components/task-trace/TaskTraceConsole"
import { CardTitle, CardDescription } from "@/components/ui/card"
import { FileText } from "lucide-react"

export default function TaskTraceLogsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 pb-4 border-b">
        <FileText className="w-5 h-5 text-primary" />
        <div>
          <CardTitle className="text-lg font-semibold tracking-tight">
            任务追踪日志
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            查看、导出和管理后台 Task Trace 记录，用于性能诊断和问题排查
          </CardDescription>
        </div>
      </div>
      <TaskTraceConsole />
    </div>
  )
}
