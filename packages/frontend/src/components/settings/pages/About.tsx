"use client"
import { Info, Package, Code2, GitBranch } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardTitle, CardDescription } from "@/components/ui/card"

// 关于页面：展示版本信息与更新日志（v1.4.1）
export function AboutPage(){
  return (
    <div className="space-y-6">

      {/* 系统信息区块 */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b">
          <Info className="w-5 h-5 text-primary" />
          <div>
            <CardTitle className="text-lg">系统信息</CardTitle>
            <CardDescription>当前版本和技术栈</CardDescription>
          </div>
        </div>

        <Card className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-6 px-4 py-4 sm:px-5 sm:py-5">
          <div className="flex items-center gap-3">
            <Package className="w-5 h-5 text-muted-foreground" />
            <CardTitle className="text-lg">版本</CardTitle>
          </div>
          <Badge variant="secondary" className="font-mono">v1.4.1</Badge>
        </Card>

        <Card className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-6 px-4 py-4 sm:px-5 sm:py-5">
          <div className="flex items-center gap-3">
            <Code2 className="w-5 h-5 text-muted-foreground" />
            <CardTitle className="text-lg">技术栈</CardTitle>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline">Next.js</Badge>
            <Badge variant="outline">Hono</Badge>
            <Badge variant="outline">SQLite</Badge>
          </div>
        </Card>
      </div>

      {/* 更新日志区块 */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b">
          <GitBranch className="w-5 h-5 text-primary" />
          <div>
            <CardTitle className="text-lg">更新日志</CardTitle>
            <CardDescription>最近的功能更新和修复</CardDescription>
          </div>
        </div>

        <Card className="px-4 py-4 sm:px-5 sm:py-5">
          <ul className="space-y-3 text-sm">
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">86da2fc</span>
              <span className="text-muted-foreground leading-relaxed">
                模型选择器加入搜索、能力筛选与分组折叠，支持收藏与最近使用，显著提升模型定位效率。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">010f345</span>
              <span className="text-muted-foreground leading-relaxed">
                提供模型上下文信息，前后端同步暴露能力标签，方便前端呈现更多提示。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">bbdd3fe</span>
              <span className="text-muted-foreground leading-relaxed">
                拆分会话与消息加载状态，避免重复请求并让界面反馈更精准。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">55474f2</span>
              <span className="text-muted-foreground leading-relaxed">
                更新全局字体栈，改善中文字符的渲染效果与跨平台一致性。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">26f1c02</span>
              <span className="text-muted-foreground leading-relaxed">
                修复设置页连接管理的 lint 报错，保持代码质量基线。
              </span>
            </li>
          </ul>
          <p className="text-xs text-muted-foreground mt-4 pt-4 border-t">
            以上为 2025-11-06 推送变更摘要
          </p>
        </Card>
      </div>
    </div>
  )
}
