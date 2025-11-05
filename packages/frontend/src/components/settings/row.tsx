"use client"
import { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface RowProps {
  title: ReactNode
  description?: ReactNode
  right?: ReactNode
  className?: string
}

export function SettingsRow({ title, description, right, className }: RowProps) {
  return (
    <div className={cn(
      "flex items-center justify-between gap-6 px-5 py-5 mb-3 rounded-lg border border-border bg-card transition-all hover:border-primary/30 hover:shadow-sm",
      className
    )}>
      <div className="flex-1 min-w-0">
        <div className="font-medium flex items-center gap-2">{title}</div>
        {description && <div className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{description}</div>}
      </div>
      <div className="shrink-0 flex items-center gap-2">{right}</div>
    </div>
  )
}

