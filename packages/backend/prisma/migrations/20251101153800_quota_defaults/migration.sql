-- 允许 usage_quota.dailyLimit 为空，并回写默认值为 NULL 以便跟随系统设置
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_usage_quota" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "identifier" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "dailyLimit" INTEGER,
  "usedCount" INTEGER NOT NULL DEFAULT 0,
  "lastResetAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId" INTEGER,
  CONSTRAINT "usage_quota_scope_identifier_key" UNIQUE ("scope", "identifier"),
  CONSTRAINT "usage_quota_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_usage_quota" ("id", "identifier", "scope", "dailyLimit", "usedCount", "lastResetAt", "userId")
SELECT
  "id",
  "identifier",
  "scope",
  CASE
    WHEN "scope" = 'USER' AND "dailyLimit" = COALESCE(
      (SELECT CAST("value" AS INTEGER) FROM "system_settings" WHERE "key" = 'default_user_daily_quota' LIMIT 1),
      200
    ) THEN NULL
    WHEN "scope" = 'ANON' AND "dailyLimit" = COALESCE(
      (SELECT CAST("value" AS INTEGER) FROM "system_settings" WHERE "key" = 'anonymous_daily_quota' LIMIT 1),
      20
    ) THEN NULL
    ELSE "dailyLimit"
  END,
  "usedCount",
  "lastResetAt",
  "userId"
FROM "usage_quota";

DROP TABLE "usage_quota";
ALTER TABLE "new_usage_quota" RENAME TO "usage_quota";

CREATE INDEX "usage_quota_userId_idx" ON "usage_quota"("userId");

PRAGMA foreign_keys=ON;
