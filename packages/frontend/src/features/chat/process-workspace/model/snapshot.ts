/**
 * 快照指纹：宿主用它判断"这次 publish 是否真的变了"。
 *
 * 调用方每次渲染都可能给出新的对象/数组引用（例如消息行内联构造 toolEvents），
 * 只比较引用会导致发布循环和焦点被反复处理；这里比较结构性事实：
 * 事件数 + 末条事件 id/时间、推理长度、产物数、流式与只读标记、覆盖与终态。
 * 已知边界：单个事件内容变化但不改 updatedAt 时指纹不变（真实工具事件都会更新 updatedAt）。
 */
import type { ProcessSnapshot } from '../types'

const lastEventStamp = (snapshot: ProcessSnapshot): string => {
  const events = snapshot.toolEvents ?? []
  if (events.length === 0) return '0'
  const last = events[events.length - 1]
  const time = typeof last.updatedAt === 'number' ? last.updatedAt : last.createdAt
  return `${events.length}:${last.id}:${time}`
}

export const processSnapshotFingerprint = (snapshot: ProcessSnapshot): string =>
  [
    String(snapshot.meta.stableKey ?? snapshot.meta.id),
    snapshot.meta.streamStatus ?? '',
    snapshot.reasoningRaw?.length ?? 0,
    lastEventStamp(snapshot),
    snapshot.artifacts?.length ?? 0,
    snapshot.isStreaming ? '1' : '0',
    snapshot.readOnly ? '1' : '0',
    snapshot.coverage ? JSON.stringify(snapshot.coverage) : '',
    snapshot.runTerminal ? JSON.stringify(snapshot.runTerminal) : '',
  ].join('|')

export const isSameProcessSnapshot = (a: ProcessSnapshot | null, b: ProcessSnapshot): boolean =>
  a != null && processSnapshotFingerprint(a) === processSnapshotFingerprint(b)
