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
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">fdcc2d9</span>
              <span className="text-muted-foreground leading-relaxed">
                分享接口路径提取 SHARE_BASE 并统一 list/create/update/revoke 路径，更新改用 PATCH、撤销改用 POST，接口语义更一致。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">2a8abdb</span>
              <span className="text-muted-foreground leading-relaxed">
                上下文超限错误解析后端/前端一致化，提取 token 上限与占用并返回中文提示，保留结构化 payload 便于友好呈现。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">8865b5a</span>
              <span className="text-muted-foreground leading-relaxed">
                修复刷新后轮询覆盖本地快照导致内容/推理回退，流式 watcher 清理与智能合并持久化，刷新后前端状态即时同步。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">46742a1</span>
              <span className="text-muted-foreground leading-relaxed">
                推理折叠状态持久化，跨刷新与会话保持展开偏好，并对本地存储自动裁剪。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">5d49a47</span>
              <span className="text-muted-foreground leading-relaxed">
                分享模式支持一键全选/全不选，可快速批量勾选当前会话的可分享消息。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">762f3c7</span>
              <span className="text-muted-foreground leading-relaxed">
                新增个人提示词，聊天构造优先级调整为会话 &gt; 个人 &gt; 全局，个人设置提供管理入口。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">9141226</span>
              <span className="text-muted-foreground leading-relaxed">
                推理播放进度持久化，刷新后延续打字动画并同步工具日志细节，避免重复回放。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">70e23e7</span>
              <span className="text-muted-foreground leading-relaxed">
                会话模型更新接口改用 PUT，契合 REST 语义避免错误动词带来的兼容性隐患。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">f4042e5</span>
              <span className="text-muted-foreground leading-relaxed">
                调整 use-chat-composer hook 顺序，避免 activeModel 未定义时的潜在运行时异常。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">d28c958</span>
              <span className="text-muted-foreground leading-relaxed">
                API 分模块并拆分 TaskTraceConsole 过滤/表格/详情组件，更新导入与测试夹具。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">2f93131</span>
              <span className="text-muted-foreground leading-relaxed">
                动画与系统设置页面模块化迁移，补充文档与快照，统一特性目录结构。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">ceff969</span>
              <span className="text-muted-foreground leading-relaxed">
                自定义请求头新增校验与数量上限提示，校验逻辑集中复用并完善测试覆盖。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">f83f167</span>
              <span className="text-muted-foreground leading-relaxed">
                聊天组件与欢迎页全面拆分为特性模块，消息气泡与 store 重构并补充单元测试。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">294f7d8</span>
              <span className="text-muted-foreground leading-relaxed">
                前端 API 客户端按特性占位重构，新增行数守卫脚本与 ESLint 行数规则，完善 PR 模板与文档。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">8127c6c</span>
              <span className="text-muted-foreground leading-relaxed">
                数学内容块节点规范化，拆分包含公式的段落，确保 LaTeX 处理结构正确。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">2cf5fc5</span>
              <span className="text-muted-foreground leading-relaxed">
                Python 调用详情样式防溢出并移除描述段，代码展示支持换行与折行。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">d91e656</span>
              <span className="text-muted-foreground leading-relaxed">
                系统提示词长度上限提升并集中常量，创建/更新接口统一校验且 README 补充配置说明。
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded mt-0.5">379d7de</span>
              <span className="text-muted-foreground leading-relaxed">
                后端镜像引入 Python 科学计算栈（numpy、sympy、scipy、matplotlib、pandas），支持数据分析能力。
              </span>
            </li>
          </ul>
          <p className="text-xs text-muted-foreground mt-4 pt-4 border-t">
            以上为 2025-12-06 推送变更摘要
          </p>
        </Card>
      </div>
    </div>
  )
}
