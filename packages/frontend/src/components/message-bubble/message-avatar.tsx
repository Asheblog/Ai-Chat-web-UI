'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

interface MessageAvatarProps {
  src?: string | null
  alt: string
  fallback: string
  className?: string
}

/**
 * 消息头像。
 *
 * 占位字母必须首帧就在：`AvatarFallback` 不传 `delayMs`，否则 Radix 会延后挂载占位，
 * 加载窗口里既没有图也没有字母，看起来就是一个「空圈」。
 *
 * 图片也不要挂任何从透明度 0 起播的进入动画：占位在 `loaded` 那一帧就卸载了，淡入会把
 * 同一段时间变成透明窗口，等于把空圈缩短到 150ms 再演一遍。Radix 的替换本身就是同帧的。
 */
export function MessageAvatar({ src, alt, fallback, className }: MessageAvatarProps) {
  return (
    <Avatar className={className}>
      <AvatarImage src={src ?? undefined} alt={alt} />
      <AvatarFallback className="text-muted-foreground">{fallback}</AvatarFallback>
    </Avatar>
  )
}
