type AuthSnapshotKey = 'actor' | 'user' | 'quota'

/**
 * 持久化合并：只恢复首屏快照（actor / user / quota），**永不恢复 actorState**。
 *
 * 登录态必须由 /auth/actor 的服务端判定重新得出：Cookie 到期后浏览器会直接删掉它，
 * 若沿用本地快照里的 `actorState: 'authenticated'`，UI 会继续显示「已登录」，
 * 直到某个用户级接口返回 401 才硬跳登录页。旧版本 localStorage 里残留的
 * actorState 也在这里被丢弃。
 *
 * 该模块刻意不 import 任何 store，避免 store ↔ 持久化工具之间形成循环依赖
 * （architecture check 会把循环依赖判为失败）。
 */
export const mergePersistedAuthState = <S extends Record<AuthSnapshotKey, unknown>>(
  persisted: unknown,
  current: S,
): S => {
  const snapshot = (
    persisted && typeof persisted === 'object' ? persisted : {}
  ) as Partial<Record<AuthSnapshotKey, unknown>>

  return {
    ...current,
    actor: (snapshot.actor ?? null) as S['actor'],
    user: (snapshot.user ?? null) as S['user'],
    quota: (snapshot.quota ?? null) as S['quota'],
  }
}
