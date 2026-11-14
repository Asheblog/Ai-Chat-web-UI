import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/features/chat/process-workspace', () => ({
  ProcessWorkspaceEntry: (props: {content?: string; readOnly?: boolean; reasoningRaw: string}) =>
    <div data-testid="workspace-entry" data-readonly={String(props.readOnly)}>{props.content}:{props.reasoningRaw}</div>,
}))
import { CotTimeline } from '../cot-timeline'

describe('CoT workspace integration', () => {
 it('routes real message content to the unified workspace with a read-only default', () => {
   render(<CotTimeline meta={{id:1,stableKey:'message-1',sessionId:1,role:'assistant',createdAt:'2026-11-14'}} reasoningRaw="可见摘要" toolEvents={[]} content="实际回答" />)
   expect(screen.getByTestId('workspace-entry')).toHaveTextContent('实际回答:可见摘要')
   expect(screen.getByTestId('workspace-entry')).toHaveAttribute('data-readonly','true')
 })
})
