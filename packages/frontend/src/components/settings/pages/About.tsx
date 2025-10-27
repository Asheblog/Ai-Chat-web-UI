"use client"

// 关于页面：展示版本信息与更新日志（v1.3.0）
export function AboutPage(){
  return (
    <div className="p-4 space-y-6">
      <div className="text-base font-medium">关于</div>
      <div className="space-y-3">
        <div className="flex items-center justify-between"><span>版本</span><span className="text-muted-foreground">v1.3.0</span></div>
        <div className="flex items-center justify-between"><span>技术栈</span><span className="text-muted-foreground">Next.js + Hono + SQLite</span></div>
      </div>

      {/* 更新日志：基于今日提交摘要生成 */}
      <div className="space-y-2">
        <div className="text-sm font-medium">更新日志</div>
        <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
          <li>新增：统一桌面与移动端路由和布局，移除 /m 路由并提供响应式体验。</li>
          <li>新增：模型选择流程支持 connectionId/rawId，前后端保持一致传递。</li>
          <li>优化：移动端聊天输入区结构与思考模式开关，简化控制并贴合触控使用。</li>
          <li>优化：模型列表项布局、文本截断及输入区域的 padding 与行高细节。</li>
          <li>修复：Markdown 代码块与预格式化文本自动换行，避免横向滚动溢出。</li>
        </ul>
        <p className="text-xs text-muted-foreground">以上为 2025-10-27 推送变更摘要</p>
      </div>
    </div>
  )
}
