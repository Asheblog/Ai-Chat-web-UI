'use client'

import { Package, Cable, KeyRound, Wrench, Link2 } from 'lucide-react'
import { MCP_TABS } from './mcp-ui'
import type { McpSubTab } from './mcp-ui'

const STEPS: { key: McpSubTab; description: string }[] = [
  { key: 'installations', description: '定义工具的来源、传输方式和参数模板' },
  { key: 'connections', description: '基于模板创建实例，关联凭据并刷新工具缓存' },
  { key: 'secrets', description: '管理 API Key 与 MCP 凭据，供连接引用' },
  { key: 'tools', description: '搜索可用工具，查看 Schema，固定常用工具' },
  { key: 'bindings', description: '将连接绑定到 system / user / session 作用域' },
]

export function OverviewTab() {
  return (
    <div className="space-y-5">
      {/* Quick stat indicators */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2.5">
        {MCP_TABS.filter((t) => t.key !== 'overview').map((tab) => {
          const Icon = tab.icon
          const step = STEPS.find((s) => s.key === tab.key)
          return (
            <div
              key={tab.key}
              className="v2-panel-soft p-3 flex items-start gap-2.5"
            >
              <Icon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground/80">{tab.label}</p>
                <p className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
                  {step?.description ?? tab.description}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Flow pipeline guide */}
      <div className="v2-panel-soft p-4">
        <p className="text-xs font-medium text-foreground/70 mb-3">推荐配置流程</p>
        <div className="flex flex-col gap-2">
          {STEPS.map((step, idx) => {
            const tab = MCP_TABS.find((t) => t.key === step.key)
            if (!tab) return null
            const Icon = tab.icon
            return (
              <div key={step.key} className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-[11px] font-semibold">
                    {idx + 1}
                  </div>
                  {idx < STEPS.length - 1 && (
                    <div className="w-px flex-1 bg-border/60 my-1" />
                  )}
                </div>
                <div className="flex items-center gap-2 pb-3 min-w-0">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <span className="text-xs font-medium text-foreground/80">{tab.label}</span>
                    <span className="text-[11px] text-muted-foreground/60 ml-2">{step.description}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
