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
    <div className={cn("flex items-center justify-between px-4 py-3", className)}>
      <div className="min-w-0 pr-4">
        <div className="font-medium truncate">{title}</div>
        {description && <div className="text-sm text-muted-foreground mt-1">{description}</div>}
      </div>
      <div className="shrink-0 flex items-center gap-2">{right}</div>
    </div>
  )
}

