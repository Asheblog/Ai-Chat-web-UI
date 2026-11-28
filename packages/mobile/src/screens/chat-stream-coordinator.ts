/**
 * ChatScreen 的流式协调器：把「同一会话同一时刻只允许一条流」和
 * 「旧流的迟到回调不得改动新流状态」收敛为纯逻辑，便于在无 React Native
 * 渲染环境时用单元测试覆盖发送 / 停止 / 切换会话的时序。
 */
export type ActiveChatStream = {
  generation: number;
  sessionId: number;
};

export class ChatStreamCoordinator {
  private generation = 0;
  private active: ActiveChatStream | null = null;

  /** 申请一条新流；已有活动流时返回 null（单飞发送）。 */
  begin(sessionId: number): number | null {
    if (this.active) return null;
    const generation = this.generation + 1;
    this.generation = generation;
    this.active = { generation, sessionId };
    return generation;
  }

  /** 该代次是否仍是当前活动流；停止、切换或自然结束后返回 false。 */
  isCurrent(generation: number): boolean {
    return this.active?.generation === generation;
  }

  get activeSessionId(): number | null {
    return this.active?.sessionId ?? null;
  }

  /** 当前流自然结束。旧代次的 release 不得清掉后来开始的新流。 */
  release(generation: number): boolean {
    if (this.active?.generation !== generation) return false;
    this.active = null;
    return true;
  }

  /** 停止 / 切换会话 / 卸载时中断当前流，并让旧代次的迟到回调全部失效。 */
  cancelActive(): ActiveChatStream | null {
    const cancelled = this.active;
    this.active = null;
    return cancelled;
  }
}
