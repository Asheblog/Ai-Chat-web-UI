/**
 * SSE 流事件发射器
 * 封装 SSE 事件的编码、发送和追踪
 */

import { summarizeSsePayload } from '../../utils/task-trace';
import type { TaskTraceRecorder } from '../../utils/task-trace';
import type { ToolLogManager } from './tool-log-manager';
import { normalizeToolCallEventPayload } from './tool-call-event';

export interface StreamEventEmitterOptions {
  encoder: InstanceType<typeof TextEncoder>;
  controller: ReadableStreamDefaultController<Uint8Array>;
  traceRecorder: TaskTraceRecorder;
  requestSignal?: AbortSignal;
  toolLogManager?: ToolLogManager;
}

/**
 * SSE 流事件发射器
 */
export class StreamEventEmitter {
  private encoder: InstanceType<typeof TextEncoder>;
  private controller: ReadableStreamDefaultController<Uint8Array>;
  private traceRecorder: TaskTraceRecorder;
  private requestSignal?: AbortSignal;
  private toolLogManager?: ToolLogManager;
  private downstreamClosed = false;
  private reasoningBuffer = '';

  constructor(options: StreamEventEmitterOptions) {
    this.encoder = options.encoder;
    this.controller = options.controller;
    this.traceRecorder = options.traceRecorder;
    this.requestSignal = options.requestSignal;
    this.toolLogManager = options.toolLogManager;
  }

  /**
   * 检查下游是否已关闭
   */
  isClosed(): boolean {
    return this.downstreamClosed;
  }

  /**
   * 获取推理缓冲区内容
   */
  getReasoningBuffer(): string {
    return this.reasoningBuffer;
  }

  /**
   * 设置推理缓冲区内容
   */
  setReasoningBuffer(content: string): void {
    this.reasoningBuffer = content;
  }

  /**
   * 安全发送 SSE 事件
   */
  enqueue(payload: Record<string, unknown>): boolean {
    if (!this.downstreamClosed && this.requestSignal?.aborted) {
      this.downstreamClosed = true;
    }
    if (this.downstreamClosed) return false;

    try {
      this.controller.enqueue(this.encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      this.traceRecorder.log('sse:dispatch', summarizeSsePayload(payload));
      return true;
    } catch {
      this.downstreamClosed = true;
      return false;
    }
  }

  /**
   * 发送内容事件
   */
  emitContent(content: string): boolean {
    return this.enqueue({ type: 'content', content });
  }

  /**
   * 发送推理事件
   */
  emitReasoning(content: string, meta?: Record<string, unknown>): void {
    const text = typeof content === 'string' ? content : '';
    if (text.length === 0) return;

    this.appendReasoningChunk(text, meta);

    const payload: Record<string, unknown> = { type: 'reasoning', content: text };
    if (meta && Object.keys(meta).length > 0) {
      payload.meta = meta;
    }
    this.enqueue(payload);
  }

  /**
   * 发送工具事件
   */
  emitToolEvent(payload: Record<string, unknown>): void {
    const enriched = normalizeToolCallEventPayload(payload);
    this.enqueue(enriched);

    // 记录到工具日志管理器
    this.toolLogManager?.record(enriched);
    this.traceRecorder.log('tool:event', summarizeSsePayload(enriched));
  }

  /**
   * 发送使用量事件
   */
  emitUsage(usage: Record<string, unknown>): boolean {
    return this.enqueue({ type: 'usage', usage });
  }

  /**
   * 发送配额事件
   */
  emitQuota(quota: Record<string, unknown>): boolean {
    return this.enqueue({ type: 'quota', quota });
  }

  /**
   * 发送开始事件
   */
  emitStart(data: {
    messageId?: number | null;
    assistantMessageId?: number | null;
    assistantClientMessageId?: string | null;
  }): boolean {
    return this.enqueue({
      type: 'start',
      messageId: data.messageId ?? null,
      assistantMessageId: data.assistantMessageId,
      assistantClientMessageId: data.assistantClientMessageId ?? null,
    });
  }

  /**
   * 发送完成事件
   */
  emitComplete(): boolean {
    return this.enqueue({ type: 'complete' });
  }

  /**
   * 发送错误事件
   */
  emitError(error: string): boolean {
    return this.enqueue({ type: 'error', error });
  }

  /**
   * 发送推理完成事件
   */
  emitReasoningDone(durationSeconds: number): boolean {
    return this.enqueue({
      type: 'reasoning',
      done: true,
      duration: durationSeconds,
      meta: { kind: 'model', stage: 'final' },
    });
  }

  /**
   * 追加推理内容到缓冲区
   */
  private appendReasoningChunk(text: string, meta?: Record<string, unknown>): void {
    if (!text) return;

    const metaKind =
      meta && typeof (meta as Record<string, unknown>).kind === 'string'
        ? ((meta as Record<string, unknown>).kind as string)
        : null;

    if (metaKind && metaKind !== 'model' && this.reasoningBuffer && !this.reasoningBuffer.endsWith('\n')) {
      this.reasoningBuffer += '\n';
    }
    this.reasoningBuffer += text;
  }

  /**
   * 标记下游已关闭
   */
  markClosed(): void {
    this.downstreamClosed = true;
  }
}
