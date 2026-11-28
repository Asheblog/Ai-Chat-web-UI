import type { ChatSession, SessionListPayload } from "../session-types";

export type SessionPageSource = {
  getSessions(page?: number, limit?: number): Promise<SessionListPayload>;
};

export type LoadedSessions = {
  sessions: ChatSession[];
  /** 首页成功、但后续分页失败时保留已读数据并标记不完整。 */
  incomplete: boolean;
};

/**
 * 加载账号的全部会话分页（与基线 SignedInScreen 行为一致，不设页数上限）。
 * 后续页失败不丢弃已读页；首页失败则向上抛出，由调用方决定是否保留旧列表。
 */
export async function loadAllSessions(
  source: SessionPageSource,
  pageSize = 100,
): Promise<LoadedSessions> {
  const first = await source.getSessions(1, pageSize);
  const collected = new Map<number, ChatSession>();
  for (const item of first.sessions ?? []) {
    collected.set(item.id, item);
  }

  const totalPages = first.pagination?.totalPages ?? 1;
  let incomplete = false;
  for (let page = 2; page <= totalPages; page += 1) {
    try {
      const payload = await source.getSessions(page, pageSize);
      for (const item of payload.sessions ?? []) {
        collected.set(item.id, item);
      }
    } catch {
      incomplete = true;
      break;
    }
  }

  return { sessions: Array.from(collected.values()), incomplete };
}
