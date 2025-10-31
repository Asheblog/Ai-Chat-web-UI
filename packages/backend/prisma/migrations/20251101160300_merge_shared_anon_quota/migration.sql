PRAGMA foreign_keys=OFF;

WITH anon_stats AS (
  SELECT
    COALESCE(SUM("usedCount"), 0) AS total_used,
    MIN("lastResetAt") AS min_reset
  FROM "usage_quota"
  WHERE "scope" = 'ANON'
)
DELETE FROM "usage_quota" WHERE "scope" = 'ANON';

INSERT INTO "usage_quota" ("scope", "identifier", "customDailyLimit", "usedCount", "lastResetAt", "userId")
SELECT 'ANON', 'anon:shared', NULL, total_used, COALESCE(min_reset, CURRENT_TIMESTAMP), NULL
FROM anon_stats
WHERE total_used > 0 OR min_reset IS NOT NULL;

INSERT INTO "usage_quota" ("scope", "identifier", "customDailyLimit", "usedCount", "lastResetAt", "userId")
SELECT 'ANON', 'anon:shared', NULL, 0, CURRENT_TIMESTAMP, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM "usage_quota" WHERE "scope" = 'ANON'
);

PRAGMA foreign_keys=ON;
