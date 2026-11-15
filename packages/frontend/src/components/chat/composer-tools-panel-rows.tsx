'use client'

import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { getComposerCapability, type ComposerCapabilityId } from './composer-toolbar-primitives'

/** 工具面板行的统一触控与排版：手机 44px 起、桌面同一密度。 */
export const composerToolsRowClass = 'flex min-h-11 w-full items-center gap-3 rounded-lg px-1.5 text-left'

export interface ComposerToolsPanelTabOption {
  id: 'capabilities' | 'context'
  label: string
}

export const composerToolsPanelTabs: readonly ComposerToolsPanelTabOption[] = [
  { id: 'capabilities', label: '能力' },
  { id: 'context', label: '上下文与设置' },
]

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
      <div className={cn(composerToolsRowClass, disabled && 'opacity-60')} data-composer-tools-row>
        <Icon className="h-[18px] w-[18px] shrink-0 text-ink-tertiary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-5 text-foreground">{panelLabel}</p>
          <p className="text-[11px] leading-4 text-muted-foreground">{description}</p>
        </div>
        <Switch
          checked={checked}
          disabled={disabled}
          onCheckedChange={(value) => onToggle(Boolean(value))}
          aria-label={panelLabel}
        />
      </div>
      {note ? <p className="pl-[30px] text-[11px] leading-4 text-muted-foreground">{note}</p> : null}
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
}

export function ComposerActionRow({ icon, label, description, trailing, disabled, onClick }: ActionRowProps) {
  return (
    <button
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
        <span className="block text-[11px] leading-4 text-muted-foreground">{description}</span>
      </span>
      {trailing ? <span className="shrink-0 text-[11px] text-muted-foreground">{trailing}</span> : null}
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-tertiary" aria-hidden="true" />
    </button>
  )
}

export function ComposerToolsSectionLabel({ children }: { children: ReactNode }) {
  return <p className="px-1.5 pb-1 pt-2 text-[11px] font-medium tracking-wide text-muted-foreground">{children}</p>
}

export function ComposerToolsDivider() {
  return <div className="my-1.5 h-px bg-border" aria-hidden="true" />
}

export function ComposerToolsTabs({
  value,
  onChange,
}: {
  value: 'capabilities' | 'context'
  onChange: (tab: 'capabilities' | 'context') => void
}) {
  return (
    <div role="tablist" aria-label="工具面板分组" className="mt-3 inline-flex rounded-[10px] bg-surface-subtle p-0.5">
      {composerToolsPanelTabs.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={`composer-tools-tab-${id}`}
          aria-selected={value === id}
          aria-controls={`composer-tools-panel-${id}`}
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
