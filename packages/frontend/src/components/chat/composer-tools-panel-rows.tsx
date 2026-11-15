'use client'

import { useId, type ReactNode, type Ref } from 'react'
import { Switch } from '@/components/ui/switch'
import { Check, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  WEB_SEARCH_SCOPE_OPTIONS,
  getComposerCapability,
  type ComposerCapabilityId,
} from './composer-toolbar-primitives'

/** 工具面板行的统一触控与排版：手机 44px 起、桌面同一密度。 */
export const composerToolsRowClass = 'flex min-h-11 w-full items-center gap-3 rounded-lg px-1.5 text-left'

export type ComposerToolsTabId = 'capabilities' | 'context'
export type ComposerToolsPanelSlot = ComposerToolsTabId | 'search-scope'

export const composerToolsTabId = (base: string, tab: ComposerToolsTabId): string => `${base}-tab-${tab}`
export const composerToolsPanelId = (base: string, slot: ComposerToolsPanelSlot): string => `${base}-panel-${slot}`

export const composerToolsPanelTabs: ReadonlyArray<{ id: ComposerToolsTabId; label: string }> = [
  { id: 'capabilities', label: '能力' },
  { id: 'context', label: '上下文与设置' },
]

interface ComposerToggleRowProps {
  icon: ReactNode
  label: string
  description?: string
  checked: boolean
  disabled?: boolean
  onToggle: (value: boolean) => void
}

/** 公共 Switch 承载整行，标题与说明独立关联，命中区至少44px。 */
export function ComposerToggleRow({ icon, label, description, checked, disabled, onToggle }: ComposerToggleRowProps) {
  const id = useId()
  return (
    <Switch
      checked={checked}
      disabled={disabled}
      onCheckedChange={onToggle}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !disabled) {
          event.preventDefault()
          onToggle(!checked)
        }
      }}
      aria-labelledby={id + '-label'}
      aria-describedby={description ? id + '-description' : undefined}
      data-composer-tools-row
      className={cn(composerToolsRowClass, 'h-auto justify-between transition-colors duration-[160ms] hover:bg-surface-hover disabled:opacity-60')}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="shrink-0 text-ink-tertiary" aria-hidden="true">{icon}</span>
        <span className="min-w-0">
          <span id={id + '-label'} className="block text-[13px] font-medium leading-5 text-foreground">{label}</span>
          {description ? <span id={id + '-description'} className="block text-[12px] leading-4 text-muted-foreground">{description}</span> : null}
        </span>
      </span>
    </Switch>
  )
}

interface CapabilityRowProps {
  id: ComposerCapabilityId
  checked: boolean
  disabled?: boolean
  note?: string
  onToggle: (value: boolean) => void
}

export function ComposerCapabilityRow({ id, checked, disabled, note, onToggle }: CapabilityRowProps) {
  const { panelLabel, description, Icon } = getComposerCapability(id)
  return (
    <div className="space-y-0.5">
      <ComposerToggleRow
        icon={<Icon className="h-[18px] w-[18px]" />}
        label={panelLabel}
        description={description}
        checked={checked}
        disabled={disabled}
        onToggle={onToggle}
      />
      {note ? <p className="pl-[30px] text-[12px] leading-4 text-muted-foreground">{note}</p> : null}
    </div>
  )
}

interface ActionRowProps {
  icon: ReactNode
  label: string
  description: string
  trailing?: string
  disabled?: boolean
  onClick?: () => void
  buttonRef?: Ref<HTMLButtonElement>
}

export function ComposerActionRow({
  icon,
  label,
  description,
  trailing,
  disabled,
  onClick,
  buttonRef,
}: ActionRowProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        composerToolsRowClass,
        'transition-colors duration-[160ms] hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-45',
      )}
    >
      <span className="shrink-0 text-ink-tertiary" aria-hidden="true">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium leading-5 text-foreground">{label}</span>
        <span className="block text-[12px] leading-4 text-muted-foreground">{description}</span>
      </span>
      {trailing ? <span className="shrink-0 text-[12px] text-muted-foreground">{trailing}</span> : null}
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-tertiary" aria-hidden="true" />
    </button>
  )
}

export function ComposerToolsSectionLabel({ children }: { children: ReactNode }) {
  return <p className="px-1.5 pb-1 pt-2 text-[12px] font-medium tracking-wide text-muted-foreground">{children}</p>
}

export function ComposerToolsDivider() {
  return <div className="my-1.5 h-px bg-border" aria-hidden="true" />
}

interface ComposerScopeOptionsProps {
  value?: string
  disabled?: boolean
  onSelect: (value: string) => void
}

/** 联网搜索范围列表：取值来自 shared 的七项枚举，沿用面板行尺寸。 */
export function ComposerScopeOptions({ value, disabled, onSelect }: ComposerScopeOptionsProps) {
  return (
    <div role="radiogroup" aria-label="搜索范围" className="space-y-0.5">
      {WEB_SEARCH_SCOPE_OPTIONS.map((option) => {
        const selected = option.value === (value ?? 'webpage')
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onSelect(option.value)}
            className={cn(
              composerToolsRowClass,
              'justify-between transition-colors duration-[160ms] hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-45',
              selected ? 'text-signal-text' : 'text-foreground',
            )}
          >
            <span className="text-[13px] leading-5">{option.label}</span>
            {selected ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
          </button>
        )
      })}
    </div>
  )
}


interface ComposerToolsTabsProps {
  idBase: string
  value: ComposerToolsTabId
  onChange: (tab: ComposerToolsTabId) => void
  listRef?: Ref<HTMLDivElement>
}

export function ComposerToolsTabs({ idBase, value, onChange, listRef }: ComposerToolsTabsProps) {
  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="工具面板分组"
      className="mt-3 inline-flex rounded-[10px] bg-surface-subtle p-0.5"
    >
      {composerToolsPanelTabs.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={composerToolsTabId(idBase, id)}
          aria-selected={value === id}
          aria-controls={composerToolsPanelId(idBase, id)}
          onClick={() => onChange(id)}
          className={cn(
            'h-11 min-w-[4.5rem] rounded-[8px] px-3 text-[13px] transition-colors duration-[160ms]',
            value === id ? 'bg-surface text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
