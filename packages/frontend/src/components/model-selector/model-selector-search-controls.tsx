import type { Dispatch, RefObject, SetStateAction } from "react"
import { Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { CapabilityFilter, SelectorView } from "./model-selector-types"
import {
  CAPABILITY_FILTER_OPTIONS,
  VIEW_FILTER_OPTIONS,
} from "./model-selector-types"

interface ModelSelectorSearchControlsProps {
  searchTerm: string
  onSearchTermChange: Dispatch<SetStateAction<string>>
  selectorView: SelectorView
  onSelectorViewChange: Dispatch<SetStateAction<SelectorView>>
  capabilityFilter: CapabilityFilter
  onCapabilityFilterChange: Dispatch<SetStateAction<CapabilityFilter>>
  searchInputRef: RefObject<HTMLInputElement>
}

export function ModelSelectorSearchControls({
  searchTerm,
  onSearchTermChange,
  selectorView,
  onSelectorViewChange,
  capabilityFilter,
  onCapabilityFilterChange,
  searchInputRef,
}: ModelSelectorSearchControlsProps) {
  return (
    <div className="space-y-3 border-b border-border/60 bg-muted/20 px-3 py-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchInputRef}
          value={searchTerm}
          onChange={(event) => onSearchTermChange(event.target.value)}
          placeholder="搜索模型 / 厂商 / 能力"
          className="h-10 rounded-lg bg-background pl-9 pr-8"
        />
        {searchTerm && (
          <button
            type="button"
            className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted"
            onClick={() => onSearchTermChange("")}
            aria-label="清空搜索"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {VIEW_FILTER_OPTIONS.map((option) => (
          <Button
            key={option.id}
            type="button"
            size="sm"
            variant={selectorView === option.id ? "default" : "outline"}
            className="h-7 rounded-full px-3 text-xs"
            onClick={() => onSelectorViewChange(option.id)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">能力</span>
        {CAPABILITY_FILTER_OPTIONS.map((option) => {
          const Icon = option.icon
          return (
            <Button
              key={option.id}
              type="button"
              size="sm"
              variant={capabilityFilter === option.id ? "default" : "outline"}
              className="h-7 rounded-full px-2.5 text-xs"
              onClick={() => onCapabilityFilterChange(option.id)}
            >
              {Icon && <Icon className="mr-1 h-3 w-3" />}
              {option.label}
            </Button>
          )
        })}
      </div>
    </div>
  )
}
