import type { Dispatch, RefObject, SetStateAction } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'

interface ModelSelectorSearchControlsProps {
  searchTerm: string
  onSearchTermChange: Dispatch<SetStateAction<string>>
  searchInputRef: RefObject<HTMLInputElement>
}

export function ModelSelectorSearchControls({ searchTerm, onSearchTermChange, searchInputRef }: ModelSelectorSearchControlsProps) {
  return (
    <div className="shrink-0 px-5 pb-3 pt-1">
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchInputRef}
          value={searchTerm}
          onChange={event => onSearchTermChange(event.target.value)}
          aria-label="搜索模型或供应商"
          placeholder="搜索模型或供应商"
          className="h-11 rounded-lg border-transparent bg-surface-subtle pl-10 pr-11 text-sm shadow-none focus-visible:border-signal focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-signal"
        />
        {searchTerm && (
          <button
            type="button"
            className="absolute right-0 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal"
            onClick={() => { onSearchTermChange(''); searchInputRef.current?.focus() }}
            aria-label="清空搜索"
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
