'use client'

import { useMemo } from 'react'
import { useChatStore } from '@/store/chat-store'
import { requestFinishWithAvailable } from '@/features/chat/api/process-control'
import { respondResearchPlanApproval } from '@/features/chat/api/streaming'
import { messageKey } from '@/features/chat/store/utils'
import type { ProcessWorkspaceCommands } from '@/features/chat/process-workspace/types'

export function useProcessCommands(sessionId: number, onRegenerate?: () => void, messageId?: string | number): ProcessWorkspaceCommands {
  return useMemo(() => ({
    onStopTools: (target) => requestFinishWithAvailable(target.sessionId, target),
    onCancelRun: (target) => { useChatStore.getState().stopStreaming(target) },
    ...(onRegenerate ? { onRegenerate: () => onRegenerate() } : {}),
    onReissuePlan: ({ planTitle }) => {
      const { messageMetas, messageBodies } = useChatStore.getState()
      const metas = messageMetas.filter(meta => meta.sessionId === sessionId)
        .slice().sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      const targetIndex = metas.findIndex(meta => messageKey(meta.id) === String(messageId))
      const parentId = metas[targetIndex]?.parentMessageId
      const parent = parentId == null ? undefined : metas.find(meta => meta.role === 'user' && messageKey(meta.id) === String(parentId))
      let content = parent ? messageBodies[messageKey(parent.id)]?.content?.trim() ?? '' : ''
      for (let index = targetIndex; !content && index >= 0; index -= 1) {
        const meta = metas[index]
        if (meta.role !== 'user') continue
        content = messageBodies[messageKey(meta.id)]?.content?.trim() ?? ''
        if (content) break
      }
      window.dispatchEvent(new CustomEvent('aichat:composer-prefill', { detail: { content: content || planTitle } }))
    },
    onResearchPlanDecision: async ({ callId, decision, feedback }) => {
      const result = await respondResearchPlanApproval(sessionId, callId, decision, feedback)
      if (!result.data.success) throw new Error('计划操作未受理，请刷新运行状态')
    },
  }), [sessionId, onRegenerate, messageId])
}
