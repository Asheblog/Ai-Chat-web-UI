"use client"

// 关于页面：展示版本信息与更新日志（v1.3.2）
export function AboutPage(){
  return (
    <div className="p-4 space-y-6">
      <div className="text-base font-medium">关于</div>
      <div className="space-y-3">
        <div className="flex items-center justify-between"><span>版本</span><span className="text-muted-foreground">v1.3.2</span></div>
        <div className="flex items-center justify-between"><span>技术栈</span><span className="text-muted-foreground">Next.js + Hono + SQLite</span></div>
      </div>

      {/* 更新日志：基于今日提交摘要生成 */}
      <div className="space-y-2">
        <div className="text-sm font-medium">更新日志</div>
        <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
          <li>新增：连接管理支持展示渠道名称，模型选择器同步显示来源，辨识更清晰。</li>
          <li>新增：侧边栏折叠重构，桌面与移动端加入内联/浮动开关与平滑过渡。</li>
          <li>新增：Sheet 组件支持自定义关闭按钮与动画，抽屉交互更柔和。</li>
          <li>优化：模型选择器按钮与弹层新增旋转与滑入动效，视觉反馈统一。</li>
          <li>优化：聊天界面与侧边栏按钮采用新配色与圆角，整体观感更一致。</li>
        </ul>
        <p className="text-xs text-muted-foreground">以上为 2025-10-28 推送变更摘要</p>
      </div>
    </div>
  )
}
