import type { ModelItem } from '@/store/models-store'
import { CAPABILITY_ICONS } from './model-selector-types'

export function ModelSelectorCapabilityBadges({ model, compact = false }: { model: ModelItem; compact?: boolean }) {
  const capabilities = model.capabilities || {}
  const active = Object.entries(CAPABILITY_ICONS).filter(([key]) => capabilities[key as keyof typeof capabilities])
  if (!active.length) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {active.map(([key, config]) => {
        const Icon = config.icon
        return <span key={key} title={config.title} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Icon aria-hidden="true" className="h-3 w-3 shrink-0" />{!compact && <span>{key === 'vision' ? '视觉' : '绘图'}</span>}{compact && <span className="sr-only">{config.title}</span>}</span>
      })}
    </span>
  )
}
