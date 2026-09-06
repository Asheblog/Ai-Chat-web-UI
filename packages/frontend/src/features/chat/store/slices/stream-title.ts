import { summarizeSessionTitle } from '@/features/chat/api/sessions'
import { useSettingsStore } from '@/store/settings-store'
import type { ChatStore, ChatStoreGetState, ChatStoreSetState } from '../types'

const deriveTitle = (text: string) => {
  let s = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^\)]*\)/g, ' ')
    .replace(/^[#>\-\*\s]+/gm, '')
    .replace(/\n+/g, ' ')
    .trim()
  const limit = 30
  return s.length > limit ? s.slice(0, limit) : s
}

const applyTitle = (
  set: ChatStoreSetState,
  sessionId: number,
  title: string,
) => {
  set((state) => ({
    sessions: state.sessions.map((s) =>
      s.id === sessionId ? { ...s, title } : s,
    ),
    currentSession:
      state.currentSession?.id === sessionId
        ? { ...state.currentSession, title }
        : state.currentSession,
  }))
}

/**
 * 首条用户消息触发会话自动命名（智能总结优先，失败回退截断）。
 * 不阻塞消息发送。
 */
export const maybeAutoTitleFirstMessage = (deps: {
  get: ChatStoreGetState
  set: ChatStoreSetState
  sessionId: number
  content: string
  snapshot: ChatStore
}) => {
  const { get, set, sessionId, content, snapshot } = deps
  try {
    const isTarget = snapshot.currentSession?.id === sessionId
    const isDefaultTitle =
      isTarget &&
      (!!snapshot.currentSession?.title === false ||
        snapshot.currentSession?.title === '新的对话' ||
        snapshot.currentSession?.title === 'New Chat')
    const userMessageCount = snapshot.messageMetas.filter(
      (meta) => meta.sessionId === sessionId && meta.role === 'user',
    ).length
    const noUserMessagesYet = userMessageCount === 0

    if (!isTarget || !isDefaultTitle || !noUserMessagesYet || !content) return

    // 获取系统设置，判断是否启用智能标题总结
    const systemSettings = useSettingsStore.getState().systemSettings
    const titleSummaryEnabled = systemSettings?.titleSummaryEnabled === true

    if (titleSummaryEnabled) {
      // 异步调用智能标题总结 API（不阻塞消息发送）
      ;(async () => {
        try {
          const result = await summarizeSessionTitle(sessionId, content)
          if (result?.title) {
            applyTitle(set, sessionId, result.title)
          }
        } catch {
          // 智能总结失败，fallback 到简单截断
          const titleCandidate = deriveTitle(content)
          if (titleCandidate) {
            applyTitle(set, sessionId, titleCandidate)
            get().updateSessionTitle(sessionId, titleCandidate).catch(() => {})
          }
        }
      })()
    } else {
      // 智能总结未启用，使用原有的截断逻辑
      const titleCandidate = deriveTitle(content)
      if (titleCandidate) {
        const prevTitle = snapshot.currentSession?.title || '新的对话'
        applyTitle(set, sessionId, titleCandidate)
        get()
          .updateSessionTitle(sessionId, titleCandidate)
          .catch(() => {
            applyTitle(set, sessionId, prevTitle)
          })
      }
    }
  } catch {
    // ignore rename errors
  }
}
