'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface ComposerActiveCapability {
  id: string
  /** 回显用短名，与工具面板行标题共用同一份能力元数据。 */
  label: string
  icon: ReactNode
  onActivate: () => void
  /** 可选补充说明，用于 title 与无障碍描述。 */
  description?: string
}

export interface ComposerActiveCapabilitiesProps {
  items: ComposerActiveCapability[]
  mobile?: boolean
  /** 可见条目上限；默认手机 2、桌面 3，调用方可按行宽收紧。 */
  maxVisible?: number
  /** +N 的点击目标：打开工具面板。 */
  onOverflowActivate?: () => void
  disabled?: boolean
  className?: string
}

const chipHitClass =
  'inline-flex h-11 shrink-0 touch-manipulation cursor-pointer items-center rounded-full disabled:pointer-events-none disabled:opacity-45 md:h-7'

const chipSurfaceClass =
  'inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-full border border-signal/40 bg-signal-soft px-2.5 text-[12px] leading-none text-signal-text'

/** 输入区已启用能力回显：点标签直达对应控制，多出的条目汇总为 +N。 */
export function ComposerActiveCapabilities({
  items,
  mobile = false,
  maxVisible,
  onOverflowActivate,
  disabled,
  className,
}: ComposerActiveCapabilitiesProps) {
  if (items.length === 0) return null

  const limit = Math.max(1, maxVisible ?? (mobile ? 2 : 3))
  const visible = items.slice(0, limit)
  const hiddenCount = items.length - visible.length

  return (
    <div
      role="group"
      aria-label="已启用能力"
      className={cn('flex min-w-0 flex-wrap items-center gap-1.5', className)}
    >
      {visible.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={item.onActivate}
          disabled={disabled}
          title={item.description ?? item.label}
          className={chipHitClass}
        >
          <span className={chipSurfaceClass}>
            {item.icon}
            <span>{item.label}</span>
          </span>
        </button>
      ))}
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={onOverflowActivate}
          disabled={disabled}
          aria-label={`还有 ${hiddenCount} 个已启用能力，打开工具面板`}
          title="查看全部已启用能力"
          className={cn(chipHitClass, 'min-w-11 justify-center')}
        >
          <span className={chipSurfaceClass}>+{hiddenCount}</span>
        </button>
      ) : null}
    </div>
  )
}
