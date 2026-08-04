/**
 * settings-flash-bus: 设置跳转定位请求的模块级单例。
 *
 * 用途：叶子页由 next/dynamic 异步挂载（可能还要等数据加载），
 * 「搜索 → 跳转 → 卡定位」的请求可能在目标页挂载前就已发出。
 * 宿主（SettingsDialog / 路由页布局）在 select 时调用 requestFlash 保存
 * 「最近一次请求」；SystemLeafWrapper 挂载后 consume 兜底消费，
 * 已挂载页面则通过 `aichat:settings-flash-card` 事件热更新。
 *
 * hostId：SettingsDialog 弹窗与路由页布局可能同时挂载同一个叶子页，
 * 请求必须归属发出它的宿主（"dialog" / "layout"），避免背景宿主的 wrapper
 * 抢先消费导致弹窗内的卡定位丢失。
 */

export type FlashRequest = {
  /** 目标叶子页 key（systemSettingsTree 叶子） */
  leafKey: string
  /** 目标卡 key（systemSettingsCards 条目），无卡定位时为 undefined */
  cardKey?: string
  /** 发出请求的宿主标识："dialog"（弹窗）或 "layout"（路由页布局） */
  hostId?: string
}

let lastRequest: FlashRequest | null = null
let dialogOpen = false

/** 保存最近一次定位请求（覆盖旧值）。 */
export function requestFlash(request: FlashRequest): void {
  lastRequest = request
}

/**
 * 取走并清空匹配的定位请求；无匹配时返回 null 且不清空。
 * 无参调用（arguments.length === 0）消费任意请求（测试清理用）；
 * 带参调用要求 leafKey 与 hostId 均精确匹配（hostId 为 undefined 时
 * 也精确匹配 undefined，避免布局宿主消费弹窗发起的请求）。
 */
export function consumeFlash(leafKey?: string, hostId?: string): FlashRequest | null {
  if (arguments.length === 0) {
    const current = lastRequest
    lastRequest = null
    return current
  }
  if (!lastRequest) return null
  if (lastRequest.leafKey !== leafKey) return null
  if (lastRequest.hostId !== hostId) return null
  const current = lastRequest
  lastRequest = null
  return current
}

/** Dialog 宿主显隐标记：打开期间路由页布局应跳过 flash 处理。 */
export function setDialogOpen(open: boolean): void {
  dialogOpen = open
}

/** 当前 SettingsDialog 是否打开。 */
export function isDialogOpen(): boolean {
  return dialogOpen
}
