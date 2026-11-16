'use client'

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface ComposerActiveCapability {
  id: string
  label: string
  icon: ReactNode
  onActivate: () => void
  description?: string
}

export interface ComposerActiveCapabilitiesProps {
  items: ComposerActiveCapability[]
  mobile?: boolean
  onOverflowActivate?: () => void
  disabled?: boolean
  className?: string
}

const buttonClass =
  'inline-flex h-[var(--capability-size)] w-[var(--capability-size)] shrink-0 touch-manipulation cursor-pointer items-center justify-center rounded-full disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal'
const surfaceClass =
  'inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-signal/40 bg-signal-soft px-1 text-[12px] leading-none text-signal-text'

/** 与工具、发送同排；按实际剩余宽度显示图标，溢出汇总为 +N。 */
export function ComposerActiveCapabilities({
  items, mobile = false, onOverflowActivate, disabled, className,
}: ComposerActiveCapabilitiesProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [slots, setSlots] = useState(items.length)
  const buttonSize = mobile ? 44 : 36
  const gap = 4

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const update = (width: number) => {
      if (width <= 0) return
      setSlots(Math.max(1, Math.floor((width + gap) / (buttonSize + gap))))
    }
    const style = getComputedStyle(container)
    update(container.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0))
    const observer = new ResizeObserver(([entry]) => update(entry.contentRect.width))
    observer.observe(container)
    return () => observer.disconnect()
  }, [buttonSize, items.length])

  if (items.length === 0) return null
  const limit = slots >= items.length ? items.length : Math.max(0, slots - 1)
  const visible = items.slice(0, limit)
  const hiddenCount = items.length - visible.length

  return (
    <div ref={containerRef} role="group" aria-label="已启用能力"
      style={{ '--capability-size': buttonSize + 'px', gap, minWidth: buttonSize } as CSSProperties}
      className={cn('flex flex-1 flex-nowrap items-center', className)}>
      {visible.map((item) => (
        <button key={item.id} type="button" onClick={item.onActivate} disabled={disabled}
          aria-label={item.label} title={item.description ? item.label + '：' + item.description : item.label}
          className={buttonClass}>
          <span className={surfaceClass} aria-hidden="true">{item.icon}</span>
        </button>
      ))}
      {hiddenCount > 0 ? (
        <button type="button" onClick={onOverflowActivate} disabled={disabled}
          aria-label={'还有 ' + hiddenCount + ' 个已启用能力，打开工具面板'}
          title="查看全部已启用能力" className={buttonClass}>
          <span className={surfaceClass}>+{hiddenCount}</span>
        </button>
      ) : null}
    </div>
  )
}
