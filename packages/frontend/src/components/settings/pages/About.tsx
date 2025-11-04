"use client"

// 关于页面：展示版本信息与更新日志（v1.3.7）
export function AboutPage(){
  return (
    <div className="p-4 space-y-6">
      <div className="text-base font-medium">关于</div>
      <div className="space-y-3">
        <div className="flex items-center justify-between"><span>版本</span><span className="text-muted-foreground">v1.3.7</span></div>
        <div className="flex items-center justify-between"><span>技术栈</span><span className="text-muted-foreground">Next.js + Hono + SQLite</span></div>
      </div>

      {/* 更新日志：基于今日提交摘要生成 */}
      <div className="space-y-2">
        <div className="text-sm font-medium">更新日志</div>
        <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
          <li>[d94d6ab] 持久化用户模型偏好，匿名/登录会话自动同步并在选择器中记忆默认模型。</li>
          <li>[83a600b] 对对话、设置等弹窗补充隐藏标题，改进屏幕阅读器可访问性。</li>
          <li>[3d85f8b] Markdown worker 渲染失败时返回空结果并提醒开发环境，避免未捕获异常。</li>
        </ul>
        <p className="text-xs text-muted-foreground">以上为 2025-11-04 推送变更摘要</p>
      </div>
    </div>
  )
}
