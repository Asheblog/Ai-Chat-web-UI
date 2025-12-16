-- CreateTable
CREATE TABLE "knowledge_bases" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" INTEGER,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'active',
    "documentCount" INTEGER NOT NULL DEFAULT 0,
    "totalChunks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "knowledge_bases_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "knowledge_base_documents" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "knowledgeBaseId" INTEGER NOT NULL,
    "documentId" INTEGER NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_base_documents_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "knowledge_bases" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "knowledge_base_documents_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "knowledge_bases_ownerId_idx" ON "knowledge_bases"("ownerId");

-- CreateIndex
CREATE INDEX "knowledge_bases_status_idx" ON "knowledge_bases"("status");

-- CreateIndex
CREATE INDEX "knowledge_bases_isPublic_idx" ON "knowledge_bases"("isPublic");

-- CreateIndex
CREATE INDEX "knowledge_base_documents_knowledgeBaseId_idx" ON "knowledge_base_documents"("knowledgeBaseId");

-- CreateIndex
CREATE INDEX "knowledge_base_documents_documentId_idx" ON "knowledge_base_documents"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_base_documents_knowledgeBaseId_documentId_key" ON "knowledge_base_documents"("knowledgeBaseId", "documentId");
