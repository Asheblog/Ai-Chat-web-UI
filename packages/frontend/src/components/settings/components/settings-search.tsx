"use client"

import { useMemo, useRef, useState } from "react"
import { Search, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { systemSettingsTree } from "../system-settings-registry"

type SearchResult = {
  key: string
  label: string
  icon: LucideIcon
  groupLabel?: string
}

/**
 * 全站设置搜索框：数据来自 systemSettingsTree 注册表。
 * 匹配叶子 label / keywords 子串（大小写不敏感），点击或 Enter 选择后
 * dispatch `aichat:system-settings-select`，由 SystemSettings 切页。
 */
export function SettingsSearch() {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const matches: SearchResult[] = []
    for (const entry of systemSettingsTree) {
      if ("children" in entry) {
        for (const leaf of entry.children) {
          const haystack = [leaf.label, ...(leaf.keywords ?? [])].join(" ").toLowerCase()
          if (haystack.includes(q)) {
            matches.push({ key: leaf.key, label: leaf.label, icon: leaf.icon, groupLabel: entry.label })
          }
        }
      } else {
        const haystack = [entry.label, ...(entry.keywords ?? [])].join(" ").toLowerCase()
        if (haystack.includes(q)) {
          matches.push({ key: entry.key, label: entry.label, icon: entry.icon, groupLabel: entry.label })
        }
      }
    }
    return matches
  }, [query])

  const selectKey = (key: string) => {
    window.dispatchEvent(new CustomEvent("aichat:system-settings-select", { detail: { key } }))
    setQuery("")
    setOpen(false)
    setHighlightIndex(0)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setOpen(true)
      setHighlightIndex((prev) => (prev + 1) % results.length)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setOpen(true)
      setHighlightIndex((prev) => (prev - 1 + results.length) % results.length)
    } else if (event.key === "Enter") {
      const target = results[highlightIndex]
      if (target) selectKey(target.key)
    } else if (event.key === "Escape") {
      setOpen(false)
    }
  }

  const showResults = open && query.trim() !== ""

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="搜索设置"
          type="text"
          placeholder="搜索设置…"
          value={query}
          className="pl-9"
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            setHighlightIndex(0)
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => setOpen(false)}
        />
      </div>
      {showResults && (
        <div
          className="v2-panel absolute left-0 right-0 z-50 mt-1 max-h-80 overflow-y-auto p-1.5"
          onMouseDown={(event) => event.preventDefault()}
        >
          {results.length === 0 ? (
            <div className="px-3 py-2.5 text-sm text-muted-foreground">无匹配设置</div>
          ) : (
            <ul className="space-y-0.5" role="listbox" aria-label="搜索结果">
              {results.map((result, index) => {
                const Icon = result.icon
                const isHighlighted = index === highlightIndex
                return (
                  <li key={result.key}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isHighlighted}
                      onMouseEnter={() => setHighlightIndex(index)}
                      onClick={() => selectKey(result.key)}
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-sm transition-colors",
                        isHighlighted
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:bg-accent/70 hover:text-foreground"
                      )}
                    >
                      {Icon && <Icon className="h-4 w-4 shrink-0" />}
                      <span className="min-w-0 flex-1 truncate">{result.label}</span>
                      {result.groupLabel && result.groupLabel !== result.label && (
                        <span className="shrink-0 text-xs text-muted-foreground/80">{result.groupLabel}</span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
