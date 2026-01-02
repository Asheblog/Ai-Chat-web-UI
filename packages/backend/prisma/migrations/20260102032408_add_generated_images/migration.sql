-- CreateTable
CREATE TABLE "generated_images" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "messageId" INTEGER NOT NULL,
    "url" TEXT,
    "storagePath" TEXT,
    "base64" TEXT,
    "mime" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "revisedPrompt" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "generated_images_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "generated_images_messageId_idx" ON "generated_images"("messageId");
