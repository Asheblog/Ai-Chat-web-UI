import type { Dispatch, RefObject, SetStateAction } from "react"
import { Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { CapabilityFilter, SelectorView } from "./model-selector-types"
import { CAPABILITY_FILTER_OPTIONS, VIEW_FILTER_OPTIONS } from "./model-selector-types"

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
  const allActive = selectorView === "all" && capabilityFilter === "all"

  const activateAll = () => {
    onSelectorViewChange("all")
    onCapabilityFilterChange("all")
  }

  const activateView = (view: SelectorView) => {
    onSelectorViewChange(view)
    onCapabilityFilterChange("all")
  }

  const activateCapability = (capability: CapabilityFilter) => {
    onSelectorViewChange("all")
    onCapabilityFilterChange(capability)
  }

  return (
    <div className="shrink-0 space-y-2 border-b border-border bg-surface px-4 py-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchInputRef}
          value={searchTerm}
          onChange={(event) => onSearchTermChange(event.target.value)}
          aria-label="搜索模型、厂商或能力"
          placeholder="搜索模型 / 厂商 / 能力"
          className="h-11 rounded-lg border-border bg-surface pl-9 pr-11 text-sm shadow-none focus-visible:outline-none focus-visible:ring-0 md:h-10"
        />
        {searchTerm && (
          <button
            type="button"
            className="absolute right-0.5 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-subtle"
            onClick={() => { onSearchTermChange(""); searchInputRef.current?.focus() }}
            aria-label="清空搜索"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div role="group" aria-label="模型筛选" className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Button
          type="button"
          size="sm"
          variant={allActive ? "default" : "outline"}
          aria-pressed={allActive}
          className="h-11 shrink-0 rounded-md px-3 text-xs md:h-8"
          onClick={activateAll}
        >
          全部
        </Button>
        {VIEW_FILTER_OPTIONS.filter((option) => option.id !== "all").map((option) => (
          <Button
            key={option.id}
            type="button"
            size="sm"
            variant={selectorView === option.id ? "default" : "outline"}
            aria-pressed={selectorView === option.id}
            className="h-11 shrink-0 rounded-md px-3 text-xs md:h-8"
            onClick={() => activateView(option.id)}
          >
            {option.label}
          </Button>
        ))}
        {CAPABILITY_FILTER_OPTIONS.filter((option) => option.id !== "all").map((option) => {
          const Icon = option.icon
          return (
            <Button
              key={option.id}
              type="button"
              size="sm"
              variant={capabilityFilter === option.id ? "default" : "outline"}
              aria-pressed={capabilityFilter === option.id}
              className="h-11 shrink-0 rounded-md px-3 text-xs md:h-8"
              onClick={() => activateCapability(option.id)}
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
