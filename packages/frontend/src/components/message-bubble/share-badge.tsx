'use client'

import { Check } from 'lucide-react'

interface ShareBadgeProps {
  positionClass: string
  shareModeActive: boolean
  shareSelectable: boolean
  shareSelected: boolean
  onToggle?: () => void
}

export function ShareBadge({
  positionClass,
  shareModeActive,
  shareSelectable,
  shareSelected,
  onToggle,
}: ShareBadgeProps) {
  if (!shareModeActive) return null
  if (shareSelectable && onToggle) {
    return (
      <button
        type="button"
        className={`absolute ${positionClass} top-3 h-6 w-6 rounded-full border ${
          shareSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-primary/40 bg-background'
        } flex items-center justify-center shadow-sm transition-colors`}
        onClick={() => onToggle()}
        aria-pressed={shareSelected}
        aria-label={shareSelected ? '取消选择此消息' : '选择此消息'}
      >
        {shareSelected ? <Check className="h-3 w-3" /> : null}
      </button>
    )
  }

  return (
    <span className={`absolute ${positionClass} top-3 text-[11px] text-muted-foreground`}>
      待同步
    </span>
  )
}
