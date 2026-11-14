/**
 * 空态：没有任何过程记录。Entry 自己整块消失时不占位，页面只留说明。
 * 这里不造假"空进度条"，也不写 0 次调用。
 */
import type { ProcessWorkspaceEntryProps } from '@/features/chat/process-workspace/types'
import { at, previewMeta } from './primitives'

const meta = previewMeta({
  stableKey: 'preview-empty-902',
  sessionId: 12,
  id: 902,
  reasoningStatus: 'idle',
  reasoningDurationSeconds: null,

})

export const emptyCase: ProcessWorkspaceEntryProps = {
  meta,
  reasoningRaw: '',
  toolEvents: [],
  content: '',
  coverage: {
    trace: { status: 'unknown' },
    persisted: { status: 'unknown', asOf: at(0) },
    projection: { status: 'unknown' },
  },
}
