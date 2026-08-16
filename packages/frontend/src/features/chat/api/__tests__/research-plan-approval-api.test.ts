import { beforeEach, describe, expect, it, vi } from 'vitest'

const { post } = vi.hoisted(() => ({ post: vi.fn() }))

vi.mock('@/lib/api', () => ({
  apiHttpClient: { post },
  handleUnauthorizedRedirect: vi.fn(),
}))

import { respondResearchPlanApproval } from '../streaming'

describe('respondResearchPlanApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    post.mockResolvedValue({ data: { success: true } })
  })

  it('posts approve decision to the research plan endpoint', async () => {
    await respondResearchPlanApproval(7, 'call-1', 'approve')
    expect(post).toHaveBeenCalledWith('/chat/stream/research-plan/respond', {
      sessionId: 7,
      toolCallId: 'call-1',
      decision: 'approve',
    })
  })

  it('includes feedback for adjust decisions', async () => {
    await respondResearchPlanApproval(7, 'call-2', 'adjust', '请补充成本数据')
    expect(post).toHaveBeenCalledWith('/chat/stream/research-plan/respond', {
      sessionId: 7,
      toolCallId: 'call-2',
      decision: 'adjust',
      feedback: '请补充成本数据',
    })
  })
})
