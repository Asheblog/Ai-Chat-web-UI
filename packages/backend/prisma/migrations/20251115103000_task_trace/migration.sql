-- Task trace tables
CREATE TABLE "task_traces" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "sessionId" INTEGER,
  "messageId" INTEGER,
  "clientMessageId" TEXT,
  "actor" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "traceLevel" TEXT NOT NULL DEFAULT 'standard',
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" DATETIME,
  "durationMs" INTEGER,
  CONSTRAINT "task_traces_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "chat_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "task_traces_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "task_traces_sessionId_idx" ON "task_traces"("sessionId");
CREATE INDEX "task_traces_messageId_idx" ON "task_traces"("messageId");
CREATE INDEX "task_traces_status_idx" ON "task_traces"("status");
CREATE INDEX "task_traces_startedAt_idx" ON "task_traces"("startedAt");

CREATE TABLE "task_trace_events" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "traceId" INTEGER NOT NULL,
  "seq" INTEGER NOT NULL,
  "eventType" TEXT NOT NULL,
  "payload" TEXT NOT NULL,
  "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_trace_events_traceId_fkey" FOREIGN KEY ("traceId") REFERENCES "task_traces"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "task_trace_events_traceId_seq_key" ON "task_trace_events"("traceId", "seq");
CREATE INDEX "task_trace_events_traceId_timestamp_idx" ON "task_trace_events"("traceId", "timestamp");
