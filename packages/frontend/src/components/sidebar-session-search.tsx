'use client'

import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'

interface SidebarSessionSearchProps {
  onChange: (query: string) => void
  debounceMs?: number
}

/**
 * 搜索输入的草稿态与侧栏列表隔离：每次按键只重渲染输入框，
 * 停顿后再提交过滤条件，避免逐字符重算会话分组。
 */
export function SidebarSessionSearch({ onChange, debounceMs = 160 }: SidebarSessionSearchProps) {
  const [draft, setDraft] = useState('')
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      onChangeRef.current(draft.trim())
    }, debounceMs)
    return () => window.clearTimeout(timer)
  }, [draft, debounceMs])

  return (
    <div className="relative flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="搜索对话"
        className="h-9 w-full rounded-md border border-border bg-surface px-3 pl-9 text-sm outline-none transition focus-visible:border-primary/45 focus-visible:ring-2 focus-visible:ring-ring/25"
        aria-label="搜索会话"
      />
    </div>
  )
}
