import { SystemLogsPage } from "@/components/settings/pages/SystemLogsPage"
import { TerminalSquare } from "lucide-react"

export default function SystemLogsRoutePage() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        <div className="border-b border-border pb-5">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground">
              <TerminalSquare className="h-5 w-5" />
            </span>
            <div className="space-y-1">
              <h1 className="text-title-l font-semibold tracking-tight">系统运行日志</h1>
              <p className="text-sm text-muted-foreground">
                查看后端服务运行日志，用于监控和排障
              </p>
            </div>
          </div>
        </div>
        <SystemLogsPage />
      </div>
    </div>
  )
}
