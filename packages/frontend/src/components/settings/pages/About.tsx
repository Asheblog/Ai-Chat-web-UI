"use client"
import { Info, Package, Code2, GitBranch } from "lucide-react"
import { Badge } from "@/components/ui/badge"

// 关于页面：展示版本信息与更新日志（v1.3.7）
export function AboutPage(){
  return (
    <div className="space-y-6">

      {/* 系统信息区块 */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b">
          <Info className="w-5 h-5 text-primary" />
          <div>
            <h3 className="text-lg font-semibold">系统信息</h3>
            <p className="text-sm text-muted-foreground">当前版本和技术栈</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-6 px-5 py-5 rounded-lg border border-border bg-card">
          <div className="flex items-center gap-3">
            <Package className="w-5 h-5 text-muted-foreground" />
            <div className="font-medium">版本</div>
          </div>
          <Badge variant="secondary" className="font-mono">v1.3.7</Badge>
        </div>

        <div className="flex items-center justify-between gap-6 px-5 py-5 rounded-lg border border-border bg-card">
          <div className="flex items-center gap-3">
            <Code2 className="w-5 h-5 text-muted-foreground" />
            <div className="font-medium">技术栈</div>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline">Next.js</Badge>
            <Badge variant="outline">Hono</Badge>
            <Badge variant="outline">SQLite</Badge>
          </div>
        </div>
      </div>

      {/* 更新日志区块 */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b">
          <GitBranch className="w-5 h-5 text-primary" />
          <div>
            <h3 className="text-lg font-semibold">更新日志</h3>
            <p className="text-sm text-muted-foreground">最近的功能更新和修复</p>
          </div>
        </div>

        <div className="px-5 py-5 rounded-lg border border-border bg-card">
          <ul className="space-y-3 text-sm">
            <li className="flex gap-3">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded">d94d6ab</span>
              <span className="text-muted-foreground leading-relaxed">
                持久化用户模型偏好，匿名/登录会话自动同步并在选择器中记忆默认模型
              </span>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded">83a600b</span>
              <span className="text-muted-foreground leading-relaxed">
                对对话、设置等弹窗补充隐藏标题，改进屏幕阅读器可访问性
              </span>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded">3d85f8b</span>
              <span className="text-muted-foreground leading-relaxed">
                Markdown worker 渲染失败时返回空结果并提醒开发环境，避免未捕获异常
              </span>
            </li>
          </ul>
          <p className="text-xs text-muted-foreground mt-4 pt-4 border-t">
            以上为 2025-11-04 推送变更摘要
          </p>
        </div>
      </div>
    </div>
  )
}
