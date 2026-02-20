import { SystemLogsPage } from "@/components/settings/pages/SystemLogsPage"
import { TerminalSquare } from "lucide-react"

export default function SystemLogsRoutePage() {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        <div className="overflow-hidden rounded-2xl border border-border/80 bg-[linear-gradient(135deg,hsl(var(--surface))/0.95,hsl(var(--background-alt))/0.72)] p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
              <TerminalSquare className="h-5 w-5" />
            </span>
            <div className="space-y-1">
              <h1 className="text-xl font-semibold tracking-tight">系统运行日志</h1>
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
