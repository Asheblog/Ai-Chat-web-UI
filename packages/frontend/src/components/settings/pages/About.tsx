"use client"

// 关于页面：展示版本信息与更新日志（v1.1.0）
export function AboutPage(){
  return (
    <div className="p-4 space-y-6">
      <div className="text-base font-medium">关于</div>
      <div className="space-y-3">
        <div className="flex items-center justify-between"><span>版本</span><span className="text-muted-foreground">v1.1.0</span></div>
        <div className="flex items-center justify-between"><span>技术栈</span><span className="text-muted-foreground">Next.js + Hono + SQLite</span></div>
      </div>

      {/* 更新日志：基于今日提交摘要生成 */}
      <div className="space-y-2">
        <div className="text-sm font-medium">更新日志</div>
        <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
          <li>修复：表格水平滚动行为异常（UI）。</li>
          <li>修复：新建聊天并发点击导致重复创建问题。</li>
          <li>修复：验证厂商 usage 有效性并添加回退逻辑。</li>
          <li>修复：命令错误问题。</li>
          <li>修复：内存超出问题。</li>
        </ul>
        <p className="text-xs text-muted-foreground">以上为 2025-10-25 推送变更摘要</p>
      </div>
    </div>
  )
}
