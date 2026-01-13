"use client"
import { Info, Package, Code2, GitBranch } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardTitle, CardDescription } from "@/components/ui/card"
import { APP_VERSION } from "@/lib/app-meta"

// 关于页面：展示版本信息与更新日志（版本号由 app-meta 统一维护）
export function AboutPage() {
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
          <Badge variant="secondary" className="font-mono">{APP_VERSION}</Badge>
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
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">bba7b82</span>
              <span className="text-muted-foreground leading-relaxed">
                升级文档/知识库工具接口，支持增强搜索模式。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">6bd6577</span>
              <span className="text-muted-foreground leading-relaxed">
                重构聊天模块，使用注册表模式统一工具处理器，支持知识库功能。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">c7cd0d9</span>
              <span className="text-muted-foreground leading-relaxed">
                改进 PDF 文本提取失败时的错误提示信息。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">2a800d2</span>
              <span className="text-muted-foreground leading-relaxed">
                支持在非流式回退响应中持久化生成的图片。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">e704efa</span>
              <span className="text-muted-foreground leading-relaxed">
                新增图片生成本地存储功能，支持通过 URL 访问。
              </span>
            </li>
          </ul>
          <p className="text-xs text-muted-foreground mt-4 pt-4 border-t">
            以上为 2026-01-13 推送变更摘要
          </p>
        </Card>
      </div>
    </div>
  )
}
