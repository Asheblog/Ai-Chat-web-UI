"use client"

import { useState } from "react"
import { KnowledgeBaseCreateDialog } from "./knowledge-base-create-dialog"
import { KnowledgeBaseDetailDialog } from "../knowledge-base-detail-dialog"
import { KnowledgeBaseList } from "./knowledge-base-list"
import { useKnowledgeBaseAdmin } from "./use-knowledge-base-admin"
import { useKnowledgeBaseUpload } from "./use-knowledge-base-upload"

export interface KnowledgeBasePanelProps {
  /** 服务端生效的单文件上限（ragMaxFileSizeMb 的已保存值） */
  maxFileSizeMb: number
}

/**
 * 知识库管理段：列表、新建、删除、刷新统计与文档上传。
 * 数据层与上传层各自成 hook，本组件只做组装与弹框开关。
 */
export function KnowledgeBasePanel({ maxFileSizeMb }: KnowledgeBasePanelProps) {
  const admin = useKnowledgeBaseAdmin()
  const [createOpen, setCreateOpen] = useState(false)

  const upload = useKnowledgeBaseUpload({
    knowledgeBaseId: admin.selectedKb?.id ?? null,
    maxFileSizeMb,
    onUploaded: async () => {
      if (admin.selectedKb) await admin.fetchDetail(admin.selectedKb.id)
      await admin.fetchList()
    },
  })

  return (
    <div className="space-y-3">
      <KnowledgeBaseList
        knowledgeBases={admin.knowledgeBases}
        loading={admin.loading}
        maxFileSizeMb={maxFileSizeMb}
        onRefresh={() => void admin.fetchList()}
        onRequestCreate={() => setCreateOpen(true)}
        onOpenDetail={admin.openDetail}
        onRefreshStats={(kb) => void admin.refreshStats(kb)}
        onDelete={(kb) => void admin.remove(kb)}
      />

      <KnowledgeBaseCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={admin.create}
      />

      <KnowledgeBaseDetailDialog
        open={admin.detailOpen}
        onOpenChange={admin.setDetailOpen}
        selectedKb={admin.selectedKb}
        kbDocuments={admin.documents}
        docsLoading={admin.docsLoading}
        uploading={upload.uploading}
        uploadProgress={upload.uploadProgress}
        uploadingFiles={upload.uploadingFiles}
        selectedDocIds={admin.selectedDocIds}
        batchDeleting={admin.batchDeleting}
        onToggleSelectAll={admin.toggleSelectAll}
        onToggleSelect={admin.toggleSelectDoc}
        onBatchRemove={() => void admin.batchRemove()}
        onRemoveDocument={(docId) => void admin.removeDocument(docId)}
        onUpload={(event) => void upload.upload(event)}
      />
    </div>
  )
}
