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
 * 加载窗口里既没有图也没有字母，看起来就是一个「空圈」。图片就绪后 Radix 在同一帧替换
 * 占位，配合淡入避免突兀。
 */
export function MessageAvatar({ src, alt, fallback, className }: MessageAvatarProps) {
  return (
    <Avatar className={className}>
      <AvatarImage
        src={src ?? undefined}
        alt={alt}
        className="animate-in fade-in-0 duration-150"
      />
      <AvatarFallback className="text-muted-foreground">{fallback}</AvatarFallback>
    </Avatar>
  )
}
