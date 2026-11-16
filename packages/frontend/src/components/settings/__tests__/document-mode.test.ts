import { describe, expect, test } from "vitest"
import type { SystemSettings } from "@/types"
import {
  DOCUMENT_MODE_OPTIONS,
  isKnowledgeBaseWithoutRetrieval,
  resolveDocumentMode,
  type DocumentKnowledgeMode,
} from "@/components/settings/pages/search-knowledge/document-knowledge/document-mode"

const settingsOf = (patch: Partial<SystemSettings>): SystemSettings =>
  ({ ragEnabled: false, knowledgeBaseEnabled: false, ...patch }) as SystemSettings

describe("resolveDocumentMode：两个能力键还原一个模式", () => {
  test("知识库开、文档解析关的旧组合解析为知识库，而不是关闭", () => {
    // 这是历史上的合法状态：先看知识库，页面才不会把知识库显示成关闭
    const mode: DocumentKnowledgeMode = resolveDocumentMode(
      settingsOf({ ragEnabled: false, knowledgeBaseEnabled: true }),
    )
    expect(mode).toBe("knowledge-base")
  })

  test("两个都开 = 知识库；只开文档解析 = 仅聊天附件；都关 = 关闭", () => {
    expect(resolveDocumentMode(settingsOf({ ragEnabled: true, knowledgeBaseEnabled: true }))).toBe(
      "knowledge-base",
    )
    expect(resolveDocumentMode(settingsOf({ ragEnabled: true, knowledgeBaseEnabled: false }))).toBe(
      "attachments",
    )
    expect(resolveDocumentMode(settingsOf({ ragEnabled: false, knowledgeBaseEnabled: false }))).toBe(
      "off",
    )
  })

  test("只有旧组合需要提示保存会补齐文档解析依赖", () => {
    expect(isKnowledgeBaseWithoutRetrieval(settingsOf({ ragEnabled: false, knowledgeBaseEnabled: true }))).toBe(true)
    expect(isKnowledgeBaseWithoutRetrieval(settingsOf({ ragEnabled: true, knowledgeBaseEnabled: true }))).toBe(false)
    expect(isKnowledgeBaseWithoutRetrieval(settingsOf({ ragEnabled: false, knowledgeBaseEnabled: false }))).toBe(false)
  })

  test("每个模式都有唯一的面板文案", () => {
    expect(DOCUMENT_MODE_OPTIONS.map((option) => option.value)).toEqual([
      "off",
      "attachments",
      "knowledge-base",
    ])
  })
})
