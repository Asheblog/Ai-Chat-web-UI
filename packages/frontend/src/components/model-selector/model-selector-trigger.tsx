import { ChevronDown } from "lucide-react"
import type { ModelItem } from "@/store/models-store"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface ModelSelectorTriggerProps {
  open: boolean
  selected?: ModelItem
  disabled?: boolean
  className?: string
  variant: "default" | "inline"
}

export function ModelSelectorTrigger({
  open,
  selected,
  disabled,
  className,
  variant,
}: ModelSelectorTriggerProps) {
  return (
    <Button
      type="button"
      variant="outline"
      role="combobox"
      aria-expanded={open}
      aria-label="选择模型"
      disabled={disabled}
      className={cn(
        "border-border/70 bg-background/95 shadow-sm transition-colors hover:border-border hover:bg-accent/45",
        variant === "inline"
          ? "h-9 w-9 rounded-lg p-0"
          : "h-11 min-w-[240px] justify-between rounded-lg px-3",
        className
      )}
    >
      {variant === "inline" ? (
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      ) : (
        <>
          <span className="min-w-0 text-left">
            <span className="block truncate text-sm font-medium">
              {selected ? selected.name : "选择模型"}
            </span>
            {selected && (
              <span className="block truncate text-[11px] text-muted-foreground">
                {selected.provider}
              </span>
            )}
          </span>
          <ChevronDown
            className={cn(
              "ml-2 h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180"
            )}
          />
        </>
      )}
    </Button>
  )
}
