"use client"

import { cn } from "@/lib/utils"

export function SystemOverviewContent() {
  const overviewItems = [
    { label: "模型管理", value: "目录与能力", tone: "text-blue-600" },
    { label: "连接管理", value: "Provider / Key", tone: "text-emerald-600" },
    { label: "成员与权限", value: "角色 / 额度", tone: "text-violet-600" },
    { label: "审计日志", value: "Skill / 任务", tone: "text-amber-600" },
  ]

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {overviewItems.map((item) => (
        <div key={item.label} className="v2-panel p-5">
          <div className="text-sm font-medium text-muted-foreground">{item.label}</div>
          <div className={cn("mt-3 text-lg font-semibold", item.tone)}>{item.value}</div>
        </div>
      ))}
    </div>
  )
}
