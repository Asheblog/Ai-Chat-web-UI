import { useEffect, useRef } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ModelReasoningEffort } from './model-selector-types'

interface ModelReasoningEffortOption {
  value: ModelReasoningEffort
  label: string
  hint?: string
}

/** 六值选项与文案，顺序即呈现顺序（默认 → Low → Medium → High → XHigh → Max）；unset 以“默认”呈现，并说明不显式设置。 */
export const MODEL_REASONING_EFFORT_OPTIONS: readonly ModelReasoningEffortOption[] = [
  { value: 'unset', label: '默认', hint: '不设置' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
  { value: 'max', label: 'Max' },
]

export const formatModelReasoningEffortLabel = (value: ModelReasoningEffort): string =>
  MODEL_REASONING_EFFORT_OPTIONS.find(option => option.value === value)?.label ?? '默认'

interface ModelSelectorEffortFooterProps {
  value: ModelReasoningEffort
  disabled?: boolean
  onOpen: () => void
}

/** 模型列表底部的强度入口；右值始终显示当前强度。 */
export function ModelSelectorEffortFooter({ value, disabled, onOpen }: ModelSelectorEffortFooterProps) {
  const label = formatModelReasoningEffortLabel(value)
  return (
    <button
      type="button"
      data-effort-footer=""
      disabled={disabled}
      onClick={onOpen}
      aria-label={`思考强度，当前 ${label}`}
      className="flex min-h-11 w-full shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-2 text-left text-[13px] text-foreground transition-colors duration-[160ms] hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal disabled:pointer-events-none disabled:opacity-45 motion-reduce:transition-none md:min-h-10"
    >
      <span className="font-medium">思考强度</span>
      <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
        <span className="truncate text-xs">{label}</span>
        <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      </span>
    </button>
  )
}

interface ModelSelectorEffortListProps {
  value: ModelReasoningEffort
  disabled?: boolean
  onChange: (value: ModelReasoningEffort) => void
}

export function ModelSelectorEffortList({ value, disabled, onChange }: ModelSelectorEffortListProps) {
  const listRef = useRef<HTMLUListElement>(null)

  // 进入强度视图后把焦点交给当前项，键盘用户无需再 Tab 一次。
  useEffect(() => {
    const list = listRef.current
    const target = list?.querySelector<HTMLButtonElement>('[data-effort-select][aria-pressed="true"]')
      ?? list?.querySelector<HTMLButtonElement>('[data-effort-select]')
    target?.focus({ preventScroll: true })
  }, [])

  return (
    <ul ref={listRef} aria-label="思考强度选项" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
      {MODEL_REASONING_EFFORT_OPTIONS.map(option => {
        const selected = option.value === value
        return (
          <li key={option.value} data-effort-row={option.value}>
            <button
              type="button"
              data-effort-select=""
              data-effort-value={option.value}
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={cn(
                'flex min-h-12 w-full min-w-0 items-center gap-2 rounded-lg px-3 py-1.5 text-left transition-colors duration-[160ms] hover:bg-surface-hover active:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal disabled:pointer-events-none disabled:opacity-45 motion-reduce:transition-none',
              )}
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium leading-5 text-foreground">{option.label}</span>
              {option.hint && <span className="shrink-0 text-xs leading-4 text-muted-foreground">{option.hint}</span>}
              {selected && <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-foreground" />}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
