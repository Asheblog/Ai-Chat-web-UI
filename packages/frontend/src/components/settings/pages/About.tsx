"use client"

// 关于页面：展示版本信息与更新日志（v1.3.1）
export function AboutPage(){
  return (
    <div className="p-4 space-y-6">
      <div className="text-base font-medium">关于</div>
      <div className="space-y-3">
        <div className="flex items-center justify-between"><span>版本</span><span className="text-muted-foreground">v1.3.1</span></div>
        <div className="flex items-center justify-between"><span>技术栈</span><span className="text-muted-foreground">Next.js + Hono + SQLite</span></div>
      </div>

      {/* 更新日志：基于今日提交摘要生成 */}
      <div className="space-y-2">
        <div className="text-sm font-medium">更新日志</div>
        <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
          <li>新增：设置模块针对移动端改造为响应式布局，优化表格、按钮与侧边导航交互。</li>
          <li>优化：消息气泡与消息列表组件加入 memo 化，减少流式响应中的重复渲染。</li>
          <li>优化：聊天输入区自动伸缩逻辑及外观细节，确保移动与桌面体验一致。</li>
        </ul>
        <p className="text-xs text-muted-foreground">以上为 2025-10-28 推送变更摘要</p>
      </div>
    </div>
  )
}
