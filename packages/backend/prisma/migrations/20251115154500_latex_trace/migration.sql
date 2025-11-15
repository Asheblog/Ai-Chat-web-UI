-- CreateTable
CREATE TABLE "latex_traces" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "task_trace_id" INTEGER NOT NULL,
    "matched_blocks" INTEGER NOT NULL DEFAULT 0,
    "unmatched_blocks" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "log_file_path" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "latex_traces_task_trace_id_fkey" FOREIGN KEY ("task_trace_id") REFERENCES "task_traces" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "latex_traces_task_trace_id_key" ON "latex_traces"("task_trace_id");

-- CreateIndex
CREATE INDEX "latex_traces_status_idx" ON "latex_traces"("status");
