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
  readOnly?: boolean
  readOnlyMessage?: string
  children: React.ReactNode
}

export function SettingsShellNested({
  title = '设置',
  tree,
  activeMain,
  activeSub,
  onChangeMain,
  onChangeSub,
  readOnly = false,
  readOnlyMessage,
  children,
}: Props) {
  const [openKey, setOpenKey] = useState<string>('')

  useEffect(() => {
    setOpenKey(activeMain)
  }, [activeMain])

  // 右侧内容标题由各具体页面自身渲染，此处无需计算 activeLabel

  return (
    <div className="w-full bg-background flex-1 min-h-0">
      <div className="flex h-full min-h-0 flex-col md:flex-row">
        {/* 左侧：单列菜单 + 下拉式二级 */}
        <aside className="w-full shrink-0 border-b bg-muted/30 flex flex-col min-h-0 md:w-60 md:border-b-0 md:border-r overflow-y-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent hover:scrollbar-thumb-muted-foreground">
          <div className="px-4 py-6 font-bold text-lg sticky top-0 z-10 bg-muted/30 md:static">
            {title}
          </div>
          <nav className="px-2 pb-4 space-y-1">
            {tree.map((m) => {
              const isOpen = openKey === m.key
              const isActiveMain = activeMain === m.key
              return (
                <div key={m.key}>
                  {/* 一级菜单：可点击展开/收起 */}
                  <button
                    type="button"
                    onClick={() => setOpenKey(isOpen ? '' : m.key)}
                    className={cn(
                      'w-full flex items-center gap-2 rounded-md px-4 py-2.5 text-left text-sm font-medium transition-all',
                      isActiveMain
                        ? 'bg-accent text-accent-foreground'
                        : 'text-foreground hover:bg-accent/50'
                    )}
                  >
                    {isOpen ? (
                      <ChevronDown className="w-4 h-4 shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 shrink-0" />
                    )}
                    <span className="flex-1">{m.label}</span>
                  </button>

                  {/* 二级菜单：仅在展开时显示 */}
                  {isOpen && (
                    <div className="ml-2 mt-1 space-y-0.5">
                      {m.children?.map((s) => {
                        const isActive = activeSub === s.key
                        return (
                          <button
                            key={s.key}
                            type="button"
                            onClick={() => { onChangeMain(m.key); onChangeSub(s.key) }}
                            className={cn(
                              'w-full flex items-center gap-3 rounded-md px-4 py-2.5 text-left text-sm transition-all',
                              isActive
                                ? 'bg-primary text-primary-foreground font-medium shadow-sm'
                                : 'text-foreground hover:bg-accent'
                            )}
                          >
                            {s.icon && <span className="shrink-0 w-[1.125rem] h-[1.125rem]">{s.icon}</span>}
                            <span className="flex-1">{s.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </nav>
        </aside>

        {/* 右侧内容：标题由各页面自行渲染，避免重复 */}
        <section className="flex-1 min-h-0 flex flex-col">
          {readOnly && (
            <div className="px-6 py-3 border-b bg-muted/20 text-sm text-muted-foreground">
              {readOnlyMessage || '当前模式下无法编辑设置，请登录后再试。'}
            </div>
          )}
          <div
            className={cn(
              'flex-1 min-h-0 overflow-auto px-4 py-4 md:px-6 md:py-6 transition-opacity scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent hover:scrollbar-thumb-muted-foreground',
              readOnly ? 'pointer-events-none opacity-60' : ''
            )}
          >
            {children}
          </div>
        </section>
      </div>
    </div>
  )
}
