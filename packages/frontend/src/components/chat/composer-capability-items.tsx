'use client'

import type { ComposerActiveCapability } from './composer-active-capabilities'
import { getComposerCapability, type ComposerCapabilityId } from './composer-toolbar-primitives'

export interface ComposerCapabilityState {
  thinkingEnabled: boolean
  webSearchEnabled: boolean
  canUseWebSearch: boolean
  deepResearchEnabled: boolean
  pythonToolEnabled: boolean
  canUsePythonTool: boolean
}

export interface ComposerCapabilityActivators {
  thinking: () => void
  webSearch: () => void
  deepResearch: () => void
  python: () => void
}

/**
 * 已启用能力标签的唯一构造处：双端与欢迎页共用，图标与短名来自同一份能力元数据。
 * 顺序固定为 思考 → 联网 → 深度研究 → Python，与工具面板行顺序一致。
 */
export function buildComposerCapabilityItems(
  state: ComposerCapabilityState,
  activators: ComposerCapabilityActivators,
): ComposerActiveCapability[] {
  const items: ComposerActiveCapability[] = []
  const push = (id: ComposerCapabilityId, onActivate: () => void) => {
    const { label, panelLabel, Icon } = getComposerCapability(id)
    items.push({
      id,
      label,
      icon: (
        <span aria-hidden="true" className="inline-flex">
          <Icon className="h-3.5 w-3.5" />
        </span>
      ),
      description: panelLabel,
      onActivate,
    })
  }

  if (state.thinkingEnabled) push('thinking', activators.thinking)
  if (state.webSearchEnabled && state.canUseWebSearch) push('web-search', activators.webSearch)
  if (state.deepResearchEnabled) push('deep-research', activators.deepResearch)
  if (state.pythonToolEnabled && state.canUsePythonTool) push('python', activators.python)

  return items
}

export const countEnabledSkills = (skills: Array<{ enabled: boolean }>): number =>
  skills.filter((skill) => skill.enabled).length
