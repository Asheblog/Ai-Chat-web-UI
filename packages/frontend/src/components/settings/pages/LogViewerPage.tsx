"use client"

import { useId, useRef, useState } from "react"
import { FileText, TerminalSquare } from "lucide-react"
import { cn } from "@/lib/utils"
import { SystemLogsPage } from "./SystemLogsPage"
import { TaskTraceConsole } from "@/components/task-trace/TaskTraceConsole"

const LOG_TABS = [
  { key: "system-logs", label: "运行日志", icon: TerminalSquare },
  { key: "task-trace", label: "任务追踪", icon: FileText },
] as const

export function LogViewerPage() {
  const [active, setActive] = useState(0)
  const id = useId()
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  return (
    <div className="min-w-0 space-y-5">
      <header className="space-y-1.5">
        <h1 className="text-[22px] font-semibold tracking-[-0.3px] text-foreground">日志与追踪</h1>
        <p className="text-[13px] leading-6 text-ink-tertiary">检索服务运行日志，或追踪后台任务的执行过程。</p>
      </header>
      <div role="tablist" aria-label="日志类型" className="flex w-fit max-w-full gap-1 rounded-lg border border-border bg-surface-subtle p-1">
        {LOG_TABS.map((tab, index) => {
          const Icon = tab.icon
          return <button key={tab.key} ref={element => { refs.current[index] = element }} type="button" role="tab" id={id + "-" + tab.key} aria-controls={id + "-panel"} aria-selected={active === index} tabIndex={active === index ? 0 : -1}
            onClick={() => setActive(index)} onKeyDown={event => {
              const next = event.key === "Home" ? 0 : event.key === "End" ? LOG_TABS.length - 1 : event.key === "ArrowRight" ? (index + 1) % LOG_TABS.length : event.key === "ArrowLeft" ? (index + LOG_TABS.length - 1) % LOG_TABS.length : null
              if (next !== null) { event.preventDefault(); setActive(next); refs.current[next]?.focus() }
            }}
            className={cn("inline-flex min-h-10 items-center justify-center gap-2 rounded-md border px-3 text-[13px] transition-colors", active === index ? "border-border bg-surface font-medium text-foreground" : "border-transparent text-ink-secondary hover:bg-surface-hover hover:text-foreground")}>
            <Icon className="h-4 w-4" aria-hidden="true" />{tab.label}
          </button>
        })}
      </div>
      <section role="tabpanel" id={id + "-panel"} aria-labelledby={id + "-" + LOG_TABS[active].key} tabIndex={0} className="min-w-0">
        {active === 0 ? <SystemLogsPage /> : <TaskTraceConsole />}
      </section>
    </div>
  )
}

export default LogViewerPage
