/**
 * Ink & Mist 设置域排版常量。
 *
 * 层级只靠 1px 发丝线与色阶：没有阴影、没有渐变，圆角固定 8 / 10 / 12 / 16。
 * 页面新增卡片或字段行时从这里取类名，避免各页各写一套。
 */
export const SETTINGS_CARD = "v2-panel flex flex-col overflow-hidden"
export const SETTINGS_CARD_HEADER = "flex items-start justify-between gap-4 px-5 py-4"
export const SETTINGS_CARD_TITLE = "text-base font-semibold leading-6 text-foreground"
export const SETTINGS_CARD_DESCRIPTION = "mt-1 text-[13px] leading-relaxed text-ink-tertiary"
export const SETTINGS_CARD_BODY = "border-t border-border px-5 py-4"
export const SETTINGS_CARD_DISCLOSURE =
  "flex w-full items-center justify-between gap-4 border-t border-border px-5 py-3 text-left text-[13px] text-ink-secondary transition-colors duration-[160ms] hover:bg-surface-hover hover:text-foreground"
export const SETTINGS_CARD_ACTION = "flex min-h-16 flex-wrap items-center justify-end gap-3 border-t border-border px-5 py-3"
export const SETTINGS_FIELD_LABEL = "w-full min-w-0 [overflow-wrap:anywhere]"
export const SETTINGS_FIELD_TITLE = "text-sm font-semibold leading-6 text-foreground"
export const SETTINGS_FIELD_HINT = "mt-1 text-[13px] leading-relaxed text-ink-tertiary"
export const SETTINGS_FIELD_CONTROL = "w-full min-w-0 [&>input]:max-w-full [&>textarea]:max-w-full [&>button]:max-w-full [&>div]:max-w-full"
