"use client"

// 关于页面：展示版本信息与更新日志（v1.3.6）
export function AboutPage(){
  return (
    <div className="p-4 space-y-6">
      <div className="text-base font-medium">关于</div>
      <div className="space-y-3">
        <div className="flex items-center justify-between"><span>版本</span><span className="text-muted-foreground">v1.3.6</span></div>
        <div className="flex items-center justify-between"><span>技术栈</span><span className="text-muted-foreground">Next.js + Hono + SQLite</span></div>
      </div>

      {/* 更新日志：基于今日提交摘要生成 */}
      <div className="space-y-2">
        <div className="text-sm font-medium">更新日志</div>
        <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
          <li>[f197807] 聊天历史改用虚拟滚动并引入 Markdown worker，显著降低长会话渲染成本。</li>
          <li>[74b265a] 动态解析模型上下文窗口，移除固定 `DEFAULT_CONTEXT_TOKEN_LIMIT` 配置。</li>
          <li>[74b265a] 系统设置校验 OpenAI 地址并缓存上下文限制，前端可手动禁用扩展上下文。</li>
        </ul>
        <p className="text-xs text-muted-foreground">以上为 2025-11-04 推送变更摘要</p>
      </div>
    </div>
  )
}
