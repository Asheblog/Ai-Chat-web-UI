"use client"

import { useEffect, useMemo, useState } from "react"
import { FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SettingRow } from "@/components/settings/components/setting-row"
import { useToast } from "@/components/ui/use-toast"
import { FeatureCard } from "@/components/settings/components/feature-card"
import { useModelsStore, type ModelItem } from "@/store/models-store"
import type { SystemSettings } from "@/types"
import { DocumentAdvancedParams, type DocumentAdvancedValues } from "./document-advanced-params"
import { DocumentRetrievalParams, type DocumentRetrievalValues } from "./document-retrieval-params"
import {
  DOCUMENT_MODE_OPTIONS,
  isKnowledgeBaseWithoutRetrieval,
  resolveDocumentMode,
  type DocumentKnowledgeMode,
} from "./document-mode"
import { DOCUMENT_RANGES, clampDocumentDecimal, clampDocumentValue } from "./document-ranges"
import { EmbeddingModelPicker } from "./embedding-model-picker"
import { KnowledgeBaseAccessPolicy } from "./knowledge-base-access-policy"
import { KnowledgeBasePanel } from "./knowledge-base-panel"
import { RagDocumentsPanel } from "./rag-documents-panel"

export interface DocumentKnowledgeCardProps {
  settings: SystemSettings
  update: (payload: Partial<SystemSettings>) => Promise<void>
  refresh: () => Promise<void>
  isLoading: boolean
}

const readEmbedding = (settings: SystemSettings) => ({
  connectionId: settings.ragEmbeddingConnectionId ?? null,
  modelId: settings.ragEmbeddingModelId ?? "",
})

const readRetrieval = (settings: SystemSettings): DocumentRetrievalValues => ({
  topK: Number(settings.ragTopK ?? 5),
  relevanceThreshold: Number(settings.ragRelevanceThreshold ?? 0.3),
  maxContextTokens: Number(settings.ragMaxContextTokens ?? 4000),
})

const readAdvanced = (settings: SystemSettings): DocumentAdvancedValues => ({
  embeddingBatchSize: Number(settings.ragEmbeddingBatchSize ?? 1),
  embeddingConcurrency: Number(settings.ragEmbeddingConcurrency ?? 1),
  chunkSize: Number(settings.ragChunkSize ?? 1500),
  chunkOverlap: Number(settings.ragChunkOverlap ?? 100),
  maxFileSizeMb: Number(settings.ragMaxFileSizeMb ?? 50),
  maxPages: Number(settings.ragMaxPages ?? 200),
  retentionDays: Number(settings.ragRetentionDays ?? 30),
})

/**
 * 文档与知识库：一个入口、三种状态（关闭 / 仅聊天附件 / 聊天附件 + 知识库）。
 *
 * 界面只暴露一个模式选择，内部仍写 `ragEnabled` 与 `knowledgeBaseEnabled` 两个键，
 * 因此服务端消费者与既有数据含义不变；知识库依赖文档解析能力，这里显式写明依赖，
 * 并让知识库段只在“聊天附件 + 知识库”模式下出现。
 */
export function DocumentKnowledgeCard({ settings, update }: DocumentKnowledgeCardProps) {
  const { toast } = useToast()
  const { models, isLoading: modelsLoading, fetchAll: fetchModels } = useModelsStore()

  const [mode, setMode] = useState<DocumentKnowledgeMode>(() => resolveDocumentMode(settings))
  const [connectionId, setConnectionId] = useState<number | null>(null)
  const [modelId, setModelId] = useState("")
  const [retrieval, setRetrieval] = useState<DocumentRetrievalValues>(() => readRetrieval(settings))
  const [advanced, setAdvanced] = useState<DocumentAdvancedValues>(() => readAdvanced(settings))
  const [allowAnonymous, setAllowAnonymous] = useState(false)
  const [allowUsers, setAllowUsers] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchModels().catch(() => {})
  }, [fetchModels])

  useEffect(() => {
    const embedding = readEmbedding(settings)
    setMode(resolveDocumentMode(settings))
    setConnectionId(embedding.connectionId)
    setModelId(embedding.modelId)
    setRetrieval(readRetrieval(settings))
    setAdvanced(readAdvanced(settings))
    setAllowAnonymous(Boolean(settings.knowledgeBaseAllowAnonymous ?? false))
    setAllowUsers(Boolean(settings.knowledgeBaseAllowUsers ?? true))
  }, [settings])

  const hasEmbeddingModels = useMemo(
    () =>
      models.some((model) => {
        const type = model.modelType || "chat"
        return type === "embedding" || type === "both"
      }),
    [models],
  )

  const savedMode = resolveDocumentMode(settings)
  const savedEmbedding = readEmbedding(settings)
  const savedRetrieval = readRetrieval(settings)
  const savedAdvanced = readAdvanced(settings)
  const savedMaxFileSizeMb = Number(settings.ragMaxFileSizeMb ?? 50)

  const embeddingReady = connectionId !== null && modelId !== ""
  const valid = mode === "off" || embeddingReady

  const changed =
    mode !== savedMode ||
    connectionId !== savedEmbedding.connectionId ||
    modelId !== savedEmbedding.modelId ||
    retrieval.topK !== savedRetrieval.topK ||
    retrieval.relevanceThreshold !== savedRetrieval.relevanceThreshold ||
    retrieval.maxContextTokens !== savedRetrieval.maxContextTokens ||
    advanced.embeddingBatchSize !== savedAdvanced.embeddingBatchSize ||
    advanced.embeddingConcurrency !== savedAdvanced.embeddingConcurrency ||
    advanced.chunkSize !== savedAdvanced.chunkSize ||
    advanced.chunkOverlap !== savedAdvanced.chunkOverlap ||
    advanced.maxFileSizeMb !== savedAdvanced.maxFileSizeMb ||
    advanced.maxPages !== savedAdvanced.maxPages ||
    advanced.retentionDays !== savedAdvanced.retentionDays ||
    allowAnonymous !== Boolean(settings.knowledgeBaseAllowAnonymous ?? false) ||
    allowUsers !== Boolean(settings.knowledgeBaseAllowUsers ?? true)

  const handleModelSelect = (model: ModelItem) => {
    setConnectionId(model.connectionId)
    setModelId(model.id)
  }

  const save = async () => {
    if (!valid || saving) return

    const payload: Partial<SystemSettings> = {
      // 一个模式选择映射回两个既有能力键
      ragEnabled: mode !== "off",
      knowledgeBaseEnabled: mode === "knowledge-base",
      ragEmbeddingConnectionId: connectionId,
      ragEmbeddingModelId: modelId,
      ragTopK: clampDocumentValue(retrieval.topK, DOCUMENT_RANGES.topK),
      ragRelevanceThreshold: clampDocumentDecimal(
        retrieval.relevanceThreshold,
        DOCUMENT_RANGES.relevanceThreshold,
      ),
      ragMaxContextTokens: clampDocumentValue(
        retrieval.maxContextTokens,
        DOCUMENT_RANGES.maxContextTokens,
      ),
      ragEmbeddingBatchSize: clampDocumentValue(
        advanced.embeddingBatchSize,
        DOCUMENT_RANGES.embeddingBatchSize,
      ),
      ragEmbeddingConcurrency: clampDocumentValue(
        advanced.embeddingConcurrency,
        DOCUMENT_RANGES.embeddingConcurrency,
      ),
      ragChunkSize: clampDocumentValue(advanced.chunkSize, DOCUMENT_RANGES.chunkSize),
      ragChunkOverlap: clampDocumentValue(advanced.chunkOverlap, DOCUMENT_RANGES.chunkOverlap),
      ragMaxFileSizeMb: clampDocumentValue(advanced.maxFileSizeMb, DOCUMENT_RANGES.maxFileSizeMb),
      ragMaxPages: clampDocumentValue(advanced.maxPages, DOCUMENT_RANGES.maxPages),
      ragRetentionDays: clampDocumentValue(advanced.retentionDays, DOCUMENT_RANGES.retentionDays),
      knowledgeBaseAllowAnonymous: allowAnonymous,
      knowledgeBaseAllowUsers: allowUsers,
    }

    setSaving(true)
    try {
      await update(payload)
      toast({ title: "文档与知识库设置已保存", description: "文档服务会随后自动重载" })
    } catch (error) {
      toast({
        title: "文档与知识库设置保存失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const modeHint = DOCUMENT_MODE_OPTIONS.find((option) => option.value === mode)?.hint

  return (
    <FeatureCard
      icon={FileText}
      title="文档与知识库"
      description="解析随消息上传的文档，或开放持久化知识库给聊天检索"
      cardKey="search-knowledge:document-knowledge"
      more={<DocumentAdvancedParams values={advanced} onChange={setAdvanced} />}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-3">
          <RagDocumentsPanel />
          <Button onClick={save} disabled={!changed || !valid || saving}>
            {saving ? "保存中..." : "保存设置"}
          </Button>
        </div>
      }
    >
      <SettingRow
        title="文档检索模式"
        description={modeHint ?? "选择文档检索的开放范围。"}
        htmlFor="document-knowledge-mode"
      >
        <Select
          value={mode}
          onValueChange={(value) => setMode(value as DocumentKnowledgeMode)}
        >
          <SelectTrigger id="document-knowledge-mode">
            <SelectValue placeholder="选择模式" />
          </SelectTrigger>
          <SelectContent>
            {DOCUMENT_MODE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      {mode === "knowledge-base" && isKnowledgeBaseWithoutRetrieval(settings) ? (
        <p className="text-xs leading-5 text-ink-secondary">
          检测到知识库已开启但文档解析关闭：知识库依赖文档解析能力，保存本页会一并重新开启文档解析（不会关掉知识库）。
        </p>
      ) : null}

      {mode !== "off" ? (
        <>
          <EmbeddingModelPicker
            models={models}
            isLoading={modelsLoading}
            connectionId={connectionId}
            modelId={modelId}
            hasEmbeddingModels={hasEmbeddingModels}
            onSelect={handleModelSelect}
            onClear={() => {
              setConnectionId(null)
              setModelId("")
            }}
          />
          {!embeddingReady ? (
            <p className="text-xs leading-5 text-destructive">
              需要选择 Embedding 模型（连接 + 模型成对）后才能保存；文档解析没有向量模型不会启动。
            </p>
          ) : null}
          <DocumentRetrievalParams values={retrieval} onChange={setRetrieval} />
        </>
      ) : null}

      {mode === "knowledge-base" ? (
        <>
          <KnowledgeBaseAccessPolicy
            allowAnonymous={allowAnonymous}
            allowUsers={allowUsers}
            onAllowAnonymousChange={setAllowAnonymous}
            onAllowUsersChange={setAllowUsers}
          />
          <KnowledgeBasePanel maxFileSizeMb={savedMaxFileSizeMb} />
        </>
      ) : null}
    </FeatureCard>
  )
}
