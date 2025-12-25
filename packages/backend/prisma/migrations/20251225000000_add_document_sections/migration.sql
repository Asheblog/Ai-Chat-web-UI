-- CreateTable: 文档章节表
CREATE TABLE "document_sections" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "documentId" INTEGER NOT NULL,
    "parentId" INTEGER,
    "level" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "startPage" INTEGER,
    "endPage" INTEGER,
    "startChunk" INTEGER,
    "endChunk" INTEGER,
    "detectionMethod" TEXT NOT NULL DEFAULT 'heuristic',
    "confidence" REAL NOT NULL DEFAULT 1.0,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_sections_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "document_sections_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "document_sections" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- AddColumn: 为 document_chunks 添加 sectionId 列
ALTER TABLE "document_chunks" ADD COLUMN "sectionId" INTEGER;

-- CreateIndex: 文档章节索引
CREATE INDEX "document_sections_documentId_idx" ON "document_sections"("documentId");
CREATE INDEX "document_sections_parentId_idx" ON "document_sections"("parentId");
CREATE INDEX "document_sections_path_idx" ON "document_sections"("path");

-- CreateIndex: chunk 的 sectionId 索引
CREATE INDEX "document_chunks_sectionId_idx" ON "document_chunks"("sectionId");