import { SystemLogsPage } from "@/components/settings/pages/SystemLogsPage"

export default function SystemLogsRoutePage() {
  return (
    <div className="container max-w-6xl py-6 mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">系统运行日志</h1>
        <p className="text-muted-foreground">查看后端服务运行日志，用于监控和排障</p>
      </div>
      <SystemLogsPage />
    </div>
  )
}