-- AddColumn: document_chunks page fields
ALTER TABLE "document_chunks" ADD COLUMN "pageNumber" INTEGER;
ALTER TABLE "document_chunks" ADD COLUMN "pageStart" INTEGER;
ALTER TABLE "document_chunks" ADD COLUMN "pageEnd" INTEGER;

-- CreateIndex: document_chunks page indexes
CREATE INDEX "document_chunks_documentId_pageNumber_idx" ON "document_chunks"("documentId", "pageNumber");
CREATE INDEX "document_chunks_documentId_pageStart_idx" ON "document_chunks"("documentId", "pageStart");
CREATE INDEX "document_chunks_documentId_pageEnd_idx" ON "document_chunks"("documentId", "pageEnd");
