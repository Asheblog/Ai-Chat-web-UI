'use client'

import type { ReactNode } from 'react'
import { FadeScrollContainer } from './fade-scroll-container'

interface CotTimelineOutlineProps {
  children: ReactNode
  /** 流式时传步骤数，让提纲自动跟到底部最新步骤 */
  stickToBottomKey?: string | number | null
}

/**
 * L1 提纲层的滚动视口：限高，127 步也不会把正文顶走。
 * 轨道线放在滚动内容内部，滚动时跟着步骤一起走，不会浮在原地。
 */
export function CotTimelineOutline({
  children,
  stickToBottomKey = null,
}: CotTimelineOutlineProps) {
  return (
    <FadeScrollContainer
      className="rounded-lg"
      viewportClassName="pr-1"
      maxHeightClassName="max-h-[min(45vh,20rem)]"
      stickToBottomKey={stickToBottomKey}
    >
      <div className="relative pl-6">
        <div aria-hidden className="absolute bottom-2 left-[9px] top-2 w-px bg-border/70" />
        <div className="space-y-1 pb-1">{children}</div>
      </div>
    </FadeScrollContainer>
  )
}
