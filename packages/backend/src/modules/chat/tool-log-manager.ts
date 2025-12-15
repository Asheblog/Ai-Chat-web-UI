/**
 * 工具日志管理器
 * 负责工具调用日志的记录、更新和持久化
 */

import type { WebSearchHit } from '../../utils/web-search';
import type { ToolLogEntry, ToolLogDetails, ToolLogStage } from './tool-logs';

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
    return this.logs.length > 0 ? JSON.stringify(this.logs) : null;
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

  /**
   * 记录工具日志
   */
  record(payload: Record<string, unknown>): void {
    const stage = payload.stage as ToolLogStage;
    if (stage !== 'start' && stage !== 'result' && stage !== 'error') return;

    const tool = typeof payload.tool === 'string' && payload.tool.trim() ? payload.tool : null;
    if (!tool) return;

    const entry: ToolLogEntry = {
      id: this.ensureToolLogId(payload),
      tool,
      stage,
      query: typeof payload.query === 'string' ? payload.query : undefined,
      createdAt: Date.now(),
    };

    if (Array.isArray(payload.hits)) {
      entry.hits = (payload.hits as WebSearchHit[]).slice(0, 10);
    }
    if (typeof payload.summary === 'string' && payload.summary.trim()) {
      entry.summary = payload.summary.trim();
    }
    if (typeof payload.error === 'string' && payload.error.trim()) {
      entry.error = payload.error;
    }
    if (payload.details && typeof payload.details === 'object') {
      entry.details = payload.details as ToolLogDetails;
    }

    const existingIndex = this.logs.findIndex((log) => log.id === entry.id);
    if (existingIndex === -1) {
      this.logs.push(entry);
    } else {
      const existing = this.logs[existingIndex];
      this.logs[existingIndex] = {
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
