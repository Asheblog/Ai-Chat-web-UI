import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  ComposerFeatureControls,
  composerToolbarButtonClass,
  composerToolbarIconClass,
  composerToolbarScrollClass,
  composerToolbarSendSlotClass,
} from '@/components/chat/composer-toolbar-primitives'

describe('composer toolbar adaptive layout', () => {
  it('uses a named container with horizontal scroll fallback instead of overflow-visible', () => {
    expect(composerToolbarScrollClass).toContain('composer-toolbar')
    expect(composerToolbarScrollClass).toContain('overflow-x-auto')
    expect(composerToolbarScrollClass).not.toContain('overflow-visible')
  })

  it('marks toolbar buttons and icons for container-driven sizing', () => {
    expect(composerToolbarButtonClass).toContain('composer-toolbar-btn')
    expect(composerToolbarButtonClass).not.toMatch(/\bh-11\b/)
    expect(composerToolbarButtonClass).not.toMatch(/\bw-11\b/)
    expect(composerToolbarIconClass).toContain('composer-toolbar-icon')
    expect(composerToolbarSendSlotClass).toContain('shrink-0')
    expect(composerToolbarSendSlotClass).toContain('z-10')
  })

  it('renders Python and other feature controls with adaptive icon class', () => {
    render(
      <div className={composerToolbarScrollClass}>
        <ComposerFeatureControls
          thinkingEnabled={false}
          onToggleThinking={() => undefined}
          webSearchEnabled={false}
          onToggleWebSearch={() => undefined}
          canUseWebSearch
          pythonToolEnabled={false}
          onTogglePythonTool={() => undefined}
          canUsePythonTool
          onOpenKnowledgeBase={() => undefined}
          knowledgeBaseEnabled
          knowledgeBaseCount={0}
        />
      </div>,
    )

    const python = screen.getByRole('button', { name: 'Python' })
    expect(python.className).toContain('composer-toolbar-btn')
    expect(python.querySelector('svg')?.getAttribute('class') ?? '').toContain('composer-toolbar-icon')
  })
})
