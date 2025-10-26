"use client"

// 关于页面：展示版本信息与更新日志（v1.2.0）
export function AboutPage(){
  return (
    <div className="p-4 space-y-6">
      <div className="text-base font-medium">关于</div>
      <div className="space-y-3">
        <div className="flex items-center justify-between"><span>版本</span><span className="text-muted-foreground">v1.2.0</span></div>
        <div className="flex items-center justify-between"><span>技术栈</span><span className="text-muted-foreground">Next.js + Hono + SQLite</span></div>
      </div>

      {/* 更新日志：基于今日提交摘要生成 */}
      <div className="space-y-2">
        <div className="text-sm font-medium">更新日志</div>
        <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
          <li>新增：提供独立 /m 路由及登录、注册、主界面与设置页，自动识别设备跳转。</li>
          <li>新增：移动端主布局、聊天界面和全局模型选择器，发送/停止按钮自适应状态。</li>
          <li>优化：桌面侧边栏标题/删除按钮与滚动区域、消息气泡、代码块的响应式表现。</li>
          <li>新增：客户端消息 ID 与图片缓存，保证消息去重与资源持久化。</li>
          <li>变更：移除 CSV 导出与 usage 展示，界面回归对话核心。</li>
          <li>修复：Prisma 在 Docker 环境的挂载路径，确保数据库初始化稳定。</li>
        </ul>
        <p className="text-xs text-muted-foreground">以上为 2025-10-26 推送变更摘要</p>
      </div>
    </div>
  )
}
