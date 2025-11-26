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
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">6193056</span>
              <span className="text-muted-foreground leading-relaxed">
                支持会话级系统提示词并具备全局后备，聊天与欢迎页可编辑，按“会话&gt;全局&gt;无”顺序继承并计入上下文，系统设置新增配置入口。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">3cbc21a</span>
              <span className="text-muted-foreground leading-relaxed">
                新增请求体修改策略，保护 model/messages/stream 等关键字段，允许合并自定义 body 与 headers 并过滤敏感头，保障高级定制的安全性。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">c95c384</span>
              <span className="text-muted-foreground leading-relaxed">
                高级请求自定义改为独立弹窗，提供标题/描述/底部操作的分区布局，桌面与移动端通过回调打开，交互更聚焦。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">f844a01</span>
              <span className="text-muted-foreground leading-relaxed">
                自定义请求体与 Header 按会话做本地缓存，切换会话或刷新页面不丢失草稿配置。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">7bc840b</span>
              <span className="text-muted-foreground leading-relaxed">
                将加号菜单抽为共享组件，桌面与欢迎页复用，简化代码并保留 Web 搜索范围偏好。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">8a75c96</span>
              <span className="text-muted-foreground leading-relaxed">
                统一加号组件的行为与样式，补齐分隔符和状态处理，修复旧版下拉的交互问题。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">733e832</span>
              <span className="text-muted-foreground leading-relaxed">
                移动端输入区控件收敛到加号菜单，新增会话提示词入口，提升遮罩层级与间距并隐藏推理/Web 搜索按钮。
              </span>
            </li>
          </ul>
          <p className="text-xs text-muted-foreground mt-4 pt-4 border-t">
            以上为 2025-11-26 推送变更摘要
          </p>
        </Card>
      </div>
    </div>
  )
}
