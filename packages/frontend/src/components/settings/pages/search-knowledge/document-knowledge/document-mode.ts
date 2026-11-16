import type { SystemSettings } from "@/types"

/**
 * 文档与知识库的一个入口、三种状态。
 *
 * 内部仍由 `ragEnabled` 与 `knowledgeBaseEnabled` 两个键表达（服务端消费者不变）：
 * - off：两者都关，聊天不解析文档也不提供知识库。
 * - attachments：只开 `ragEnabled`——随消息上传的附件可解析检索，知识库不开放。
 * - knowledge-base：两者都开——附件之外还能选持久化知识库。
 */
export type DocumentKnowledgeMode = "off" | "attachments" | "knowledge-base"

export const DOCUMENT_MODE_OPTIONS: Array<{
  value: DocumentKnowledgeMode
  label: string
  hint: string
}> = [
  {
    value: "off",
    label: "关闭",
    hint: "聊天不解析文档，也不提供知识库入口。",
  },
  {
    value: "attachments",
    label: "仅聊天附件",
    hint: "随消息上传的文件可解析检索；知识库选择器不出现。",
  },
  {
    value: "knowledge-base",
    label: "聊天附件 + 知识库",
    hint: "附件之外还能选择持久化知识库；知识库依赖 Embedding 模型与文档解析能力。",
  },
]

/**
 * 由两个能力键还原模式。
 *
 * 顺序很关键：知识库是独立开关，历史上允许「知识库开、文档解析关」的组合（`rag_enabled=false`
 * + `knowledge_base_enabled=true`）。先看知识库，才能让这种旧组合落在 `knowledge-base`，
 * 保存时把缺失的文档解析依赖补回来；若先看 `ragEnabled`，页面会显示成「关闭」，
 * 之后任何一次保存都会顺手把知识库关掉——等于替用户删了这个合法状态。
 */
export const resolveDocumentMode = (settings: SystemSettings): DocumentKnowledgeMode => {
  if (settings.knowledgeBaseEnabled) return "knowledge-base"
  if (settings.ragEnabled) return "attachments"
  return "off"
}

/** 旧组合：知识库开着但文档解析关着，需要提示保存会补齐依赖。 */
export const isKnowledgeBaseWithoutRetrieval = (settings: SystemSettings) =>
  Boolean(settings.knowledgeBaseEnabled) && !settings.ragEnabled

export const documentModeLabel = (mode: DocumentKnowledgeMode) =>
  DOCUMENT_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? "关闭"
