"use client"
import { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface AuthFormLayoutProps {
  title: string
  description?: ReactNode
  error?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
}

/**
 * AuthFormLayout: 统一登录/注册等认证页的卡片骨架。
 * - 提供一致的标题、描述、错误提示与底部链接区域
 * - 避免各页面重复维护 Card 布局与样式
 */
export function AuthFormLayout({
  title,
  description,
  error,
  children,
  footer,
  className,
}: AuthFormLayoutProps) {
  return (
    <div className={cn("w-full", className)}>
      <div className="mb-6">
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        {description ? (
          <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="rounded-[calc(var(--radius)+0.35rem)] border border-border/80 bg-card/95 p-5 shadow-[0_26px_56px_hsl(var(--background)/0.38)] backdrop-blur-xl sm:p-6">
        {error ? (
          <div className="mb-4 rounded-[calc(var(--radius)-4px)] border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        {children}
      </div>
      {footer ? (
        <div className="mt-6 space-y-2 text-center text-sm text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </div>
  )
}

export default AuthFormLayout
