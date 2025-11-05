-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "hashedPassword" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "approvedAt" DATETIME,
    "approvedById" INTEGER,
    "rejectedAt" DATETIME,
    "rejectedById" INTEGER,
    "rejectionReason" TEXT,
    "preferredModelId" TEXT,
    "preferredConnectionId" INTEGER,
    "preferredModelRawId" TEXT
);
INSERT INTO "new_users" ("createdAt", "hashedPassword", "id", "preferredConnectionId", "preferredModelId", "preferredModelRawId", "role", "username") SELECT "createdAt", "hashedPassword", "id", "preferredConnectionId", "preferredModelId", "preferredModelRawId", "role", "username" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE INDEX "users_status_idx" ON "users"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
