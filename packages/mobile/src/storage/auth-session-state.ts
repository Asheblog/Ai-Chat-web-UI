import type { MobileUser } from "../auth-types";

/**
 * 登录会话必须与产生它的服务器绑定：token 与用户身份只对同一 profile 有效。
 * 切换服务器时若两者不同步，工作区会带着旧服务器的 token 去请求新服务器。
 */
export type AuthedSession = {
  profileId: string;
  token: string;
  user: MobileUser;
};

/**
 * 进程内暂存的 token 必须记录它属于哪台服务器。
 * 只存字符串时，切站前的旧客户端（闭包里的旧 profileId）会读到新服务器的 token。
 */
export type ScopedToken = {
  profileId: string;
  token: string;
};

/** 只把 token 交给产生它的服务器；profileId 不匹配一律返回 null。 */
export function tokenForProfile(
  scoped: ScopedToken | null | undefined,
  profileId: string | null | undefined,
): string | null {
  if (!scoped || !profileId) {
    return null;
  }
  return scoped.profileId === profileId ? scoped.token : null;
}

export function isSessionBoundToProfile(
  session: AuthedSession | null | undefined,
  profileId: string | null | undefined,
): boolean {
  if (!session || !profileId) {
    return false;
  }
  return session.profileId === profileId;
}

/**
 * 只有当前服务器自己的 401 才能清空界面会话；
 * 旧服务器迟到的 401 只失效它自己的凭证，不得把刚切过去的服务器顶下线。
 */
export function shouldClearLiveSession(
  activeProfileId: string | null | undefined,
  failedProfileId: string | null | undefined,
): boolean {
  if (!activeProfileId || !failedProfileId) {
    return false;
  }
  return activeProfileId === failedProfileId;
}

/** 活动服务器的会话恢复是否尚未跑完（决定显示“恢复中”还是登录页）。 */
export function isRestorePending(
  restoredProfileId: string | null | undefined,
  activeProfileId: string | null | undefined,
): boolean {
  if (!activeProfileId) {
    return false;
  }
  return restoredProfileId !== activeProfileId;
}

/**
 * 已保存的 token 只在服务端明确判定失效（401）时丢弃。
 * 网络错误、超时、5xx 都保留凭证，否则离线冷启动会永久清掉登录状态。
 */
export function shouldDiscardStoredToken(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  return (error as { status?: unknown }).status === 401;
}
