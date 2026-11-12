"use client"

/**
 * 能力扩展（占位骨架）。
 *
 * Task 1 只需让注册表的 dynamic import 与 tsc 成立：这里仅提供页头与 5 个段占位，
 * 段导航、卡定位与各段内容由后续任务（Task 2-7）实现并覆盖本文件。
 */
export function ExtensionsPage() {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">能力扩展</h1>
        <p className="text-sm text-muted-foreground">
          MCP 服务、Skill 与 Python 内置工具统一在此管理：总览状态、按段维护、就地定位。
        </p>
      </div>
      <div data-section="overview" />
      <div data-section="mcp" />
      <div data-section="skills" />
      <div data-section="tools" />
      <div data-section="extra" />
    </div>
  )
}
