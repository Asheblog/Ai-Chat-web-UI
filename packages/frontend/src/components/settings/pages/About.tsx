"use client"

// 关于页面：展示版本信息与更新日志（v1.3.4）
export function AboutPage(){
  return (
    <div className="p-4 space-y-6">
      <div className="text-base font-medium">关于</div>
      <div className="space-y-3">
        <div className="flex items-center justify-between"><span>版本</span><span className="text-muted-foreground">v1.3.4</span></div>
        <div className="flex items-center justify-between"><span>技术栈</span><span className="text-muted-foreground">Next.js + Hono + SQLite</span></div>
      </div>

      {/* 更新日志：基于今日提交摘要生成 */}
      <div className="space-y-2">
        <div className="text-sm font-medium">更新日志</div>
        <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
          <li>[7e5f232] 调整聊天输入区布局与按钮态，移动端加入safe area内边距，视觉更统一。</li>
          <li>[7bb98a3] 侧边栏改用语义化颜色令牌，统一亮/暗主题的对比度与悬停表现。</li>
          <li>[805d132] 全量替换图片为Next.js Image并补充中文alt描述，精简依赖数组减少重复渲染。</li>
          <li>[e61d494] 登录/注册页面抽离AuthFormLayout，删除冗余Shell组件，降低表单布局重复。</li>
        </ul>
        <p className="text-xs text-muted-foreground">以上为 2025-10-29 推送变更摘要</p>
      </div>
    </div>
  )
}
