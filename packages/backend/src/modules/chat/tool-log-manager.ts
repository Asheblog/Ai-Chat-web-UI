/**
 * 工具日志管理器
 * 负责工具调用日志的记录、更新和持久化
 */

import { enrichToolEventReasoningOffsets } from '@aichat/shared/tool-events';
import type { WebSearchHit } from '../../utils/web-search';
import { serializeToolLogsForPersistence, type ToolLogEntry, type ToolLogDetails, type ToolLogStage } from './tool-logs';

export interface ToolLogManagerOptions {
  sessionId: number;
  onLogDirty?: () => void;
}

/**
 * 工具日志管理器
 */
export class ToolLogManager {
  private logs: ToolLogEntry[] = [];
  private sequence = 0;
  private dirty = false;
  private sessionId: number;
  private onLogDirty?: () => void;

  constructor(options: ToolLogManagerOptions) {
    this.sessionId = options.sessionId;
    this.onLogDirty = options.onLogDirty;
  }

  /**
   * 获取所有日志
   */
  getLogs(): ToolLogEntry[] {
    return this.logs;
  }

  /**
   * 检查是否有未持久化的更改
   */
  isDirty(): boolean {
    return this.dirty;
  }

  /**
   * 标记为已持久化
   */
  markClean(): void {
    this.dirty = false;
  }

  /**
   * 序列化日志为 JSON
   */
  toJson(): string | null {
    return serializeToolLogsForPersistence(this.logs);
  }

  /**
   * 生成唯一的工具日志 ID
   */
  private ensureToolLogId(payload: Record<string, unknown>): string {
    if (typeof payload.id === 'string' && payload.id.trim()) {
      return payload.id.trim();
    }
    if (typeof payload.callId === 'string' && payload.callId.trim()) {
      return payload.callId.trim();
    }
    this.sequence += 1;
    return `session:${this.sessionId}:tool:${this.sequence}`;
  }

  /**
   * 合并工具日志详情
   */
  private mergeDetails(
    previous?: ToolLogDetails,
    next?: ToolLogDetails
  ): ToolLogDetails | undefined {
    if (!previous && !next) return undefined;
    if (!previous) return next;
    if (!next) return previous;
    return { ...previous, ...next };
  }

  private resolveToolLogLookupId(payload: Record<string, unknown>): string | null {
    if (typeof payload.id === 'string' && payload.id.trim()) {
      return payload.id.trim();
    }
    if (typeof payload.callId === 'string' && payload.callId.trim()) {
      return payload.callId.trim();
    }
    return null;
  }

  /**
   * 记录工具日志
   */
  record(payload: Record<string, unknown>, reasoningBufferLength?: number): void {
    const stage = payload.stage as ToolLogStage;
    if (stage !== 'start' && stage !== 'result' && stage !== 'error') return;

    const tool = typeof payload.tool === 'string' && payload.tool.trim() ? payload.tool : null;
    if (!tool) return;

    const lookupId = this.resolveToolLogLookupId(payload);
    const existingIndex = lookupId ? this.logs.findIndex((log) => log.id === lookupId) : -1;
    const isFirstSight = existingIndex === -1;
    const toRecord =
      typeof reasoningBufferLength === 'number'
        ? enrichToolEventReasoningOffsets(payload, reasoningBufferLength, isFirstSight)
        : payload;

    const entry: ToolLogEntry = {
      id: this.ensureToolLogId(toRecord),
      tool,
      stage,
      query: typeof toRecord.query === 'string' ? toRecord.query : undefined,
      createdAt: Date.now(),
    };

    if (Array.isArray(toRecord.hits)) {
      entry.hits = (toRecord.hits as WebSearchHit[]).slice(0, 10);
    }
    if (typeof toRecord.summary === 'string' && toRecord.summary.trim()) {
      entry.summary = toRecord.summary.trim();
    }
    if (typeof toRecord.error === 'string' && toRecord.error.trim()) {
      entry.error = toRecord.error;
    }
    if (toRecord.details && typeof toRecord.details === 'object') {
      entry.details = toRecord.details as ToolLogDetails;
    }

    const resolvedExistingIndex = this.logs.findIndex((log) => log.id === entry.id);
    if (resolvedExistingIndex === -1) {
      this.logs.push(entry);
    } else {
      const existing = this.logs[resolvedExistingIndex];
      this.logs[resolvedExistingIndex] = {
        ...existing,
        stage: entry.stage,
        query: entry.query ?? existing.query,
        hits: entry.hits ?? existing.hits,
        error: entry.error ?? existing.error,
        summary: entry.summary ?? existing.summary,
        createdAt: existing.createdAt,
        details: this.mergeDetails(existing.details, entry.details),
      };
    }

    this.dirty = true;
    this.onLogDirty?.();
  }

  /**
   * 获取日志摘要（用于 trace）
   */
  getSummary(limit = 50): Array<{
    id: string;
    tool: string;
    stage: ToolLogStage;
    query?: string;
    hits?: number;
    summary?: string;
    error?: string;
    createdAt: string;
  }> {
    return this.logs.slice(0, limit).map((item) => ({
      id: item.id,
      tool: item.tool,
      stage: item.stage,
      query: item.query,
      hits: Array.isArray(item.hits) ? item.hits.length : undefined,
      summary: item.summary,
      error: item.error,
      createdAt: new Date(item.createdAt).toISOString(),
    }));
  }
}
