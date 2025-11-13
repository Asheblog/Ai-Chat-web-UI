import { TaskTraceConsole } from "@/components/task-trace/TaskTraceConsole"

export default function TaskTraceLogsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">任务追踪日志</h1>
        <p className="text-sm text-muted-foreground">查看 / 导出 / 清理后台 task trace 记录</p>
      </div>
      <TaskTraceConsole />
    </div>
  )
}
