"use client"
import { Info, Package, Code2, GitBranch } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardTitle, CardDescription } from "@/components/ui/card"
import { APP_VERSION } from "@/lib/app-meta"

// 关于页面：展示版本信息与更新日志（版本号由 app-meta 统一维护）
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
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">4c63266</span>
              <span className="text-muted-foreground leading-relaxed">
                接入 Metaso 搜索引擎，支持网页/文档/论文/图片/视频/播客范围选择，可配置摘要与原文返回，并按引擎独立管理 API Key。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">d6a46e0</span>
              <span className="text-muted-foreground leading-relaxed">
                上线模型访问策略框架，匿名与登录用户可设置允许/拒绝/继承三态，默认策略可被逐模型覆盖，目录解析与 API 访问遵循新策略。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">e3967d8</span>
              <span className="text-muted-foreground leading-relaxed">
                模型访问控制迁移到独立管理页，新增导航入口与批量策略更新，原总览与模型页面的分散控制下线（破坏性调整）。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">5244f39</span>
              <span className="text-muted-foreground leading-relaxed">
                模型访问列表支持分页（80/页）与批量操作进度提示，成功/失败计数分离，并提醒跨页批量覆盖范围。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">8f25c39</span>
              <span className="text-muted-foreground leading-relaxed">
                模型管理列表分页并保留跨页选择，批量切换模型能力开关时展示加载与进度，避免筛选变更造成残留选择。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">8578b5d</span>
              <span className="text-muted-foreground leading-relaxed">
                个人偏好页支持管理员修改用户名，统一保存按钮提交全部偏好，用户名自动去空格校验并在保存期间禁用控件。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">24d06aa</span>
              <span className="text-muted-foreground leading-relaxed">
                聊天流新增供应商 SSE 监控，记录首包/内容/推理/用量事件及样本日志，加入首包超时回调提升异常可观测性。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">90c4049</span>
              <span className="text-muted-foreground leading-relaxed">
                聊天链路将旧流量日志替换为 Task Trace 结构化追踪，统一记录请求/响应/错误并提供清洗截断能力。
              </span>
            </li>
          </ul>
          <p className="text-xs text-muted-foreground mt-4 pt-4 border-t">
            以上为 2025-11-24 推送变更摘要
          </p>
        </Card>
      </div>
    </div>
  )
}
