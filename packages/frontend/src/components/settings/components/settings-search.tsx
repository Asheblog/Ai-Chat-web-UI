"use client"

import { useMemo, useState } from "react"
import { Search, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { systemSettingsCards, systemSettingsTree } from "../system-settings-registry"

type SearchResult = {
  /** 目标叶子页 key（卡结果取其所属叶子） */
  key: string
  label: string
  icon: LucideIcon | null
  /** 叶子结果：顶级分组名；卡结果：所属叶子页名 */
  groupLabel?: string
  /** 卡结果：卡 key（形如 leafKey:cardKey）；叶子结果无 */
  cardKey?: string
}

/**
 * 全站设置搜索框：数据来自 systemSettingsTree + systemSettingsCards 注册表。
 * 匹配叶子/卡的 label + keywords 子串（大小写不敏感），点击或 Enter 选择后
 * dispatch `aichat:system-settings-select`（detail 含 origin: "search"，卡结果附 cardKey），
 * 由宿主（SettingsDialog / 路由页布局）切页并触发位置提醒。
 */
export function SettingsSearch() {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(0)

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
    // 卡级结果（排在叶子结果之后），groupLabel 为所属叶子页名
    for (const card of systemSettingsCards) {
      const haystack = [card.label, ...(card.keywords ?? [])].join(" ").toLowerCase()
      if (!haystack.includes(q)) continue
      const leafLabel = getLeafLabelForCard(card.leafKey)
      matches.push({
        key: card.leafKey,
        label: card.label,
        icon: getLeafIcon(card.leafKey),
        groupLabel: leafLabel,
        cardKey: card.key,
      })
    }
    return matches
  }, [query])

  const selectResult = (result: SearchResult) => {
    window.dispatchEvent(
      new CustomEvent("aichat:system-settings-select", {
        detail: { key: result.key, cardKey: result.cardKey, origin: "search" },
      })
    )
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
    } else if (event.key === "Enter" && open) {
      // 仅在下拉打开时接受 Enter：Escape 关闭或 blur 之后，Enter 不应触发过期的选中项
      const target = results[highlightIndex]
      if (target) selectResult(target)
    } else if (event.key === "Escape") {
      setOpen(false)
    }
  }

  const showResults = open && query.trim() !== ""

  return (
    <div className="relative w-full">
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
                  <li key={result.cardKey ?? result.key}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isHighlighted}
                      onMouseEnter={() => setHighlightIndex(index)}
                      onClick={() => selectResult(result)}
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
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

/** 查找卡所属叶子页的 label。 */
function getLeafLabelForCard(leafKey: string): string | undefined {
  for (const entry of systemSettingsTree) {
    if ("children" in entry) {
      const leaf = entry.children.find((c) => c.key === leafKey)
      if (leaf) return leaf.label
    } else if (entry.key === leafKey) {
      return entry.label
    }
  }
  return undefined
}

/** 查找叶子页图标（卡结果复用所属叶子图标）。 */
function getLeafIcon(leafKey: string): LucideIcon | null {
  for (const entry of systemSettingsTree) {
    if ("children" in entry) {
      const leaf = entry.children.find((c) => c.key === leafKey)
      if (leaf) return leaf.icon
    } else if (entry.key === leafKey) {
      return entry.icon
    }
  }
  return null
}
