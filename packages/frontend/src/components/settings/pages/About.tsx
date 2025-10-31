"use client"

// 关于页面：展示版本信息与更新日志（v1.3.5）
export function AboutPage(){
  return (
    <div className="p-4 space-y-6">
      <div className="text-base font-medium">关于</div>
      <div className="space-y-3">
        <div className="flex items-center justify-between"><span>版本</span><span className="text-muted-foreground">v1.3.5</span></div>
        <div className="flex items-center justify-between"><span>技术栈</span><span className="text-muted-foreground">Next.js + Hono + SQLite</span></div>
      </div>

      {/* 更新日志：基于今日提交摘要生成 */}
      <div className="space-y-2">
        <div className="text-sm font-medium">更新日志</div>
        <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
          <li>[f9f5531] 移除个人连接改为系统级统一管理，并上线聊天图片上传管道。</li>
          <li>[b7bfb91] 新增匿名访客与额度策略配置，后台清理匿名会话和附件。</li>
          <li>[7126503] 模型目录改为数据库缓存，支持后台自动刷新与手动更新。</li>
          <li>[10802de] 聊天与兼容 API 补齐全链路流量日志，便于排查请求问题。</li>
        </ul>
        <p className="text-xs text-muted-foreground">以上为 2025-10-31 推送变更摘要</p>
      </div>
    </div>
  )
}
