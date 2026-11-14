// 浮层唯一允许的柔阴影：所有弹出面板共用同一个值，页面其余位置一律无阴影。
// 单独成文件是为了让「唯一一处」可被 grep 校验，也避免各面板写出不同数值。
export const OVERLAY_SHADOW = "shadow-[0_8px_24px_hsl(var(--foreground)/0.08)]"
