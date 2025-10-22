"use client"
import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import type { SettingsNavItem } from "./nav"
import { ChevronDown, ChevronRight } from "lucide-react"

interface Props {
  title?: string
  tree: SettingsNavItem[]
  activeMain: string
  activeSub: string
  onChangeMain: (key: string) => void
  onChangeSub: (key: string) => void
  headerText?: string
  children: React.ReactNode
}

export function SettingsShellNested({
  title = '设置',
  tree,
  activeMain,
  activeSub,
  onChangeMain,
  onChangeSub,
  children,
}: Props) {
  const [openKey, setOpenKey] = useState<string>('')

  useEffect(() => {
    setOpenKey(activeMain)
  }, [activeMain])

  const activeLabel = (() => {
    const main = tree.find(m => m.key === activeMain)
    return main?.children?.find(s => s.key === activeSub)?.label || ''
  })()

  return (
    <div className="mx-auto w-full max-w-5xl bg-background h-full">
      <div className="flex h-full min-h-0">
        {/* 左侧：单列菜单 + 下拉式二级 */}
        <aside className="w-60 shrink-0 border-r bg-muted/10 flex flex-col min-h-0">
          <div className="px-4 py-3 font-semibold border-b">{title}</div>
          <nav className="p-2 overflow-auto">
            {tree.map((m) => {
              const isOpen = openKey === m.key
              const isActiveMain = activeMain === m.key
              return (
                <div key={m.key} className="mb-1">
                  <button
                    type="button"
                    onClick={() => { setOpenKey(isOpen ? '' : m.key); onChangeMain(m.key) }}
                    className={cn(
                      'w-full flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors',
                      isActiveMain ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
                    )}
                  >
                    <span>{m.label}</span>
                    {isOpen ? <ChevronDown className="h-4 w-4"/> : <ChevronRight className="h-4 w-4"/>}
                  </button>
                  {isOpen && m.children && (
                    <div className="mt-1 pl-2">
                      {m.children.map((s) => (
                        <button
                          key={s.key}
                          type="button"
                          onClick={() => onChangeSub(s.key)}
                          className={cn(
                            'w-full rounded-md px-3 py-2 text-left text-sm transition-colors',
                            activeSub === s.key ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
                          )}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </nav>
        </aside>

        {/* 右侧内容 */}
        <section className="flex-1 min-h-0 flex flex-col">
          <div className="border-b px-4 py-3 font-medium">{activeLabel}</div>
          <div className="flex-1 min-h-0 overflow-auto p-4">{children}</div>
        </section>
      </div>
    </div>
  )
}

