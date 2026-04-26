"use client"
import { Info, Package, Code2, GitBranch } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  APP_COMMIT_BASE_URL,
  APP_UPDATE_DATE,
  APP_UPDATE_NOTES,
  APP_UPDATE_SCOPE,
  APP_VERSION,
} from "@/lib/app-meta"

// 关于页面：展示版本信息与更新日志（版本号由 app-meta 统一维护）
export function AboutPage() {
  return (
    <div className="space-y-4">
      <section className="v2-panel bg-white/90 p-4 shadow-none sm:p-5">
        <div className="mb-4 flex items-start gap-3 border-b border-border/70 pb-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
            <Info className="h-5 w-5" />
          </span>
          <div>
            <h2 className="v2-section-title">系统信息</h2>
            <p className="v2-muted-line mt-1">当前版本和技术栈。</p>
          </div>
        </div>

        <div className="space-y-3">
        <div className="flex flex-col gap-4 rounded-[10px] border border-border/70 bg-slate-50/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div className="flex items-center gap-3">
            <Package className="w-5 h-5 text-muted-foreground" />
            <h3 className="text-sm font-semibold">版本</h3>
          </div>
          <Badge variant="secondary" className="font-mono">{APP_VERSION}</Badge>
        </div>

        <div className="flex flex-col gap-4 rounded-[10px] border border-border/70 bg-slate-50/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div className="flex items-center gap-3">
            <Code2 className="w-5 h-5 text-muted-foreground" />
            <h3 className="text-sm font-semibold">技术栈</h3>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline">Next.js</Badge>
            <Badge variant="outline">Hono</Badge>
            <Badge variant="outline">SQLite</Badge>
          </div>
        </div>
        </div>
      </section>

      <section className="v2-panel bg-white/90 p-4 shadow-none sm:p-5">
        <div className="mb-4 flex items-start gap-3 border-b border-border/70 pb-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
            <GitBranch className="h-5 w-5" />
          </span>
          <div>
            <h2 className="v2-section-title">更新日志</h2>
            <p className="v2-muted-line mt-1">最近的功能更新和修复。</p>
          </div>
        </div>

        <div>
          <ul className="divide-y divide-border/70 text-sm">
            {APP_UPDATE_NOTES.map((item) => (
              <li key={item.commit} className="flex items-start gap-3 py-3 first:pt-0">
                <a
                  href={`${APP_COMMIT_BASE_URL}/${item.commit}`}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5 hover:text-foreground"
                >
                  {item.commit}
                </a>
                <span className="text-muted-foreground leading-relaxed">{item.summary}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground mt-4 pt-4 border-t">
            以上为 {APP_UPDATE_DATE} {APP_UPDATE_SCOPE}
          </p>
        </div>
      </section>
    </div>
  )
}
