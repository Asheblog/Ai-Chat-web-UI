'use client'

import { ProcessWorkspaceEntry } from '@/features/chat/process-workspace'
import type { ProcessWorkspaceEntryProps } from '@/features/chat/process-workspace/types'
import { useProcessDetail } from './use-process-detail'

/** Stable message entry shared by chat, public shares and isolated Battle runs. */
export type CotTimelineProps = ProcessWorkspaceEntryProps

export function CotTimeline(props: CotTimelineProps) {
  const readOnly = props.readOnly ?? !props.commands
  const detail = useProcessDetail(props.meta, !readOnly && !props.isStreaming && props.coverage?.projection?.status === 'partial')
  const message = detail.message
  return <>
    <ProcessWorkspaceEntry {...props} readOnly={readOnly}
      content={message?.content ?? props.content}
      toolEvents={message?.toolEvents?.map(event => ({ ...event, sessionId: props.meta.sessionId, messageId: props.meta.id })) ?? props.toolEvents}
      artifacts={message?.artifacts ?? props.artifacts}
      coverage={message?.toolLogCoverage ?? props.coverage}
      runTerminal={message ? {stopReason: message.stopReason ?? undefined, finalAnswerGenerated: message.finalAnswerGenerated ?? undefined} : props.runTerminal}
      onOpen={() => { void detail.load(); props.onOpen?.() }} />
    {detail.loading && <p role="status" className="text-xs text-muted-foreground">正在读取完整调用详情…</p>}
    {detail.error && <div role="alert" className="text-xs text-destructive">{detail.error}
      <button type="button" className="ml-2 min-h-11 underline focus-visible:outline" onClick={() => { void detail.load() }}>重试读取详情</button>
    </div>}
  </>
}
