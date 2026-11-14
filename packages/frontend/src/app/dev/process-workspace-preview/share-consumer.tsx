'use client'

import { useMemo } from 'react'
import { ShareViewer } from '@/components/share/share-viewer'
import type { ChatShare } from '@/types'
import type { PreviewCase } from './preview-cases'

/**
 * 真实分享消费方：ShareViewer 自己在每个消息上挂 CotTimeline（readOnly），
 * 这里只提供 ChatShare 夹具，不复制任何分享页逻辑。
 */
export function ShareConsumer({ previewCase }: { previewCase: PreviewCase }) {
  const share = useMemo<ChatShare>(() => {
    const entry = previewCase.entryProps
    const createdAt = entry.meta.createdAt
    return {
      id: 7_311,
      sessionId: entry.meta.sessionId,
      token: 'dev-preview-share-token',
      title: '今日中国新闻（dev 分享夹具）',
      sessionTitle: '今日中国新闻',
      messageCount: 2,
      isLive: false,
      streamingMessageIds: [],
      createdAt,
      expiresAt: new Date(Date.parse(createdAt) + 7 * 24 * 3_600_000).toISOString(),
      revokedAt: null,
      messages: [
        {
          id: entry.meta.id as number,
          role: 'user',
          content: '查一下今天的中国新闻。',
          createdAt,
        },
        {
          id: 7_312,
          role: 'assistant',
          content: entry.content ?? '',
          reasoning: entry.reasoningRaw,
          createdAt,
          artifacts: entry.artifacts,
          toolEvents: entry.toolEvents,
          toolLogCoverage: undefined,
          finalAnswerGenerated: true,
        },
      ],
    }
  }, [previewCase])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-preview-consumer="share-viewer">
      <ShareViewer
        share={share}
        token={share.token}
        initialMessages={share.messages}
        initialPagination={{ page: 1, limit: 50, total: share.messages.length, totalPages: 1 }}
        brandText="AIChat · dev 夹具"
      />
    </div>
  )
}
