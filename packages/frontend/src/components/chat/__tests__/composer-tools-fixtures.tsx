import { vi } from 'vitest'
import type { ReactNode } from 'react'
import type { ComposerToolsPanelProps } from '@/components/chat/composer-tools-panel'
import type { ComposerActiveCapability } from '@/components/chat/composer-active-capabilities'

/** 面板夹具：默认桌面、能力全关、无上下文动作，逐用例覆盖需要的一项。 */
export const toolsPanelProps = (
  overrides: Partial<ComposerToolsPanelProps> = {},
): ComposerToolsPanelProps => ({
  open: true,
  onOpenChange: vi.fn(),
  mobile: false,
  thinkingEnabled: false,
  onToggleThinking: vi.fn(),
  webSearchEnabled: false,
  onToggleWebSearch: vi.fn(),
  canUseWebSearch: true,
  deepResearchEnabled: false,
  onToggleDeepResearch: vi.fn(),
  pythonToolEnabled: false,
  onTogglePythonTool: vi.fn(),
  canUsePythonTool: true,
  ...overrides,
})

export const capabilityIcon = (): ReactNode => <span aria-hidden="true" data-testid="cap-icon" />

export const activeCapabilityItems = (
  labels: string[],
  onActivate = vi.fn(),
): ComposerActiveCapability[] =>
  labels.map((label, index) => ({
    id: label,
    label,
    icon: capabilityIcon(),
    onActivate: () => onActivate(index, label),
  }))
