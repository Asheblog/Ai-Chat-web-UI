import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SingleModelBattleHero } from './SingleModelBattleHero'

describe('SingleModelBattleHero', () => {
  it('keeps outline action buttons readable on the dark hero surface', () => {
    render(
      <SingleModelBattleHero
        runId={42}
        runStatus="completed"
        isRunning={false}
        sharing={false}
        shareLink={null}
        copiedShareLink={false}
        sourceRunId={null}
        error={null}
        onStart={vi.fn()}
        onCancel={vi.fn()}
        onNewTask={vi.fn()}
        onShare={vi.fn()}
        onCopyShareLink={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: '新任务' })).toHaveClass('bg-slate-950/30')
    expect(screen.getByRole('button', { name: '新任务' })).toHaveClass('text-slate-100')
    expect(screen.getByRole('button', { name: '新任务' })).toHaveClass('hover:text-slate-50')
    expect(screen.getByRole('button', { name: '分享' })).toHaveClass('bg-slate-950/30')
    expect(screen.getByRole('button', { name: '分享' })).toHaveClass('text-slate-100')
    expect(screen.getByRole('button', { name: '分享' })).toHaveClass('hover:text-slate-50')
  })
})
