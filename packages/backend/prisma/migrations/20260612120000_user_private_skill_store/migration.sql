PRAGMA foreign_keys=OFF;

CREATE TABLE "new_skills" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "namespaceKey" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'builtin',
    "sourceUrl" TEXT,
    "sourceKey" TEXT,
    "storeItemKey" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'system',
    "licenseName" TEXT,
    "licenseUrl" TEXT,
    "licenseStatus" TEXT NOT NULL DEFAULT 'approved',
    "status" TEXT NOT NULL DEFAULT 'active',
    "defaultVersionId" INTEGER,
    "createdByUserId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "skills_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "skills_defaultVersionId_fkey" FOREIGN KEY ("defaultVersionId") REFERENCES "skill_versions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_skills" (
    "id",
    "namespaceKey",
    "slug",
    "displayName",
    "description",
    "sourceType",
    "sourceUrl",
    "sourceKey",
    "storeItemKey",
    "visibility",
    "licenseName",
    "licenseUrl",
    "licenseStatus",
    "status",
    "defaultVersionId",
    "createdByUserId",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    CASE
        WHEN "sourceType" = 'builtin' THEN 'system:' || "slug"
        WHEN "createdByUserId" IS NOT NULL THEN 'user:' || "createdByUserId" || ':legacy:' || "id"
        ELSE 'system:legacy:' || "slug"
    END,
    "slug",
    "displayName",
    "description",
    "sourceType",
    "sourceUrl",
    NULL,
    NULL,
    CASE WHEN "sourceType" = 'builtin' OR "createdByUserId" IS NULL THEN 'system' ELSE 'user_private' END,
    NULL,
    NULL,
    CASE WHEN "sourceType" = 'builtin' THEN 'approved' ELSE 'unknown' END,
    "status",
    "defaultVersionId",
    "createdByUserId",
    "createdAt",
    "updatedAt"
FROM "skills";

DROP TABLE "skills";
ALTER TABLE "new_skills" RENAME TO "skills";

CREATE UNIQUE INDEX "skills_namespaceKey_key" ON "skills"("namespaceKey");
CREATE UNIQUE INDEX "skills_defaultVersionId_key" ON "skills"("defaultVersionId");
CREATE INDEX "skills_status_idx" ON "skills"("status");
CREATE INDEX "skills_createdByUserId_status_idx" ON "skills"("createdByUserId", "status");
CREATE INDEX "skills_storeItemKey_idx" ON "skills"("storeItemKey");
CREATE UNIQUE INDEX "skills_createdByUserId_storeItemKey_key" ON "skills"("createdByUserId", "storeItemKey");

ALTER TABLE "skill_bindings" ADD COLUMN "sessionId" INTEGER REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
UPDATE "skill_bindings"
SET "sessionId" = CAST("scopeId" AS INTEGER)
WHERE "scopeType" = 'session'
  AND CAST("scopeId" AS INTEGER) > 0;
CREATE INDEX "skill_bindings_sessionId_idx" ON "skill_bindings"("sessionId");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
