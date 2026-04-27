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
    <div className="space-y-2 border-b border-border/60 bg-background/95 px-3 py-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchInputRef}
          value={searchTerm}
          onChange={(event) => onSearchTermChange(event.target.value)}
          placeholder="搜索模型 / 厂商 / 能力"
          className="h-10 rounded-[8px] border-border/80 bg-background pl-9 pr-8 text-sm shadow-none"
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

      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Button
          type="button"
          size="sm"
          variant={allActive ? "default" : "outline"}
          className="h-8 shrink-0 rounded-[8px] px-3 text-xs"
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
            className="h-8 shrink-0 rounded-[8px] px-3 text-xs"
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
              className="h-8 shrink-0 rounded-[8px] px-3 text-xs"
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
