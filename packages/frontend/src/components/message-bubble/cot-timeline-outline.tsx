'use client'

import type { ReactNode } from 'react'

/** 步骤随页面滚动，不创建第二层滚动视口。 */
export function CotTimelineOutline({ children }: { children: ReactNode }) {
  return <div className="px-3 py-2 sm:px-4">{children}</div>
}
