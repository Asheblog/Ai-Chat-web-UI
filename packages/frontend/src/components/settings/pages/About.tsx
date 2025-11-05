"use client"
import { Info, Package, Code2, GitBranch } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardTitle, CardDescription } from "@/components/ui/card"

// 关于页面：展示版本信息与更新日志（v1.3.8）
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
          <Badge variant="secondary" className="font-mono">v1.3.8</Badge>
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
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">725690c</span>
              <span className="text-muted-foreground leading-relaxed">
                引入注册审批流，首位用户自动成为管理员，其余注册需审批；移除 APP_MODE 并改用 DEFAULT_REGISTRATION_ENABLED。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">01a2709</span>
              <span className="text-muted-foreground leading-relaxed">
                重构设置中心导航与卡片布局，统一徽标标签与间距，显著提升视觉层次与响应式体验。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">303b7b2</span>
              <span className="text-muted-foreground leading-relaxed">
                增加「推理默认展开」配置，支持将 OpenAI Reasoning Effort 设为 unset 并同步消息气泡展示策略。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">b7e9ba8</span>
              <span className="text-muted-foreground leading-relaxed">
                欢迎页页脚支持自定义品牌文案，未配置时自动回退为 AIChat。
              </span>
            </li>
          </ul>
          <p className="text-xs text-muted-foreground mt-4 pt-4 border-t">
            以上为 2025-11-05 推送变更摘要
          </p>
        </Card>
      </div>
    </div>
  )
}
