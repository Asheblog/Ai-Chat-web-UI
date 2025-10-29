"use client"

// 关于页面：展示版本信息与更新日志（v1.3.3）
export function AboutPage(){
  return (
    <div className="p-4 space-y-6">
      <div className="text-base font-medium">关于</div>
      <div className="space-y-3">
        <div className="flex items-center justify-between"><span>版本</span><span className="text-muted-foreground">v1.3.3</span></div>
        <div className="flex items-center justify-between"><span>技术栈</span><span className="text-muted-foreground">Next.js + Hono + SQLite</span></div>
      </div>

      {/* 更新日志：基于今日提交摘要生成 */}
      <div className="space-y-2">
        <div className="text-sm font-medium">更新日志</div>
        <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
          <li>新增：流式输出管道支持内容/推理分块聚合、断线检测与安全排队，显著提升长连接稳定性。</li>
          <li>新增：推理流程引入首段宽限、持续保活与空闲超时管理，界面实时展示推理状态与耗时。</li>
          <li>优化：推理激活逻辑可在流式回复中按需启用，确保推理内容不会遗漏。</li>
          <li>优化：手动推理开关与空内容清理更可靠，避免残留无效状态。</li>
          <li>修复：推理事件过滤条件异常，防止重复激活或丢失推理输出。</li>
        </ul>
        <p className="text-xs text-muted-foreground">以上为 2025-10-29 推送变更摘要</p>
      </div>
    </div>
  )
}
