"use client"
import { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface AuthFormLayoutProps {
  title?: string
  description?: ReactNode
  error?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
}

/**
 * AuthFormLayout: 统一登录/注册等认证页骨架。
 * Claude 极简居中：无重阴影卡片，字段区直接落在统一暖底上。
 * title 可选：登录页可省略，避免与 auth layout 品牌标题重复。
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
      {title ? (
        <div className="mb-6 text-left">
          <h2 className="text-[26px] font-bold leading-tight tracking-[-0.4px] text-foreground">{title}</h2>
          {description ? (
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-tertiary">{description}</p>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="mb-5 rounded-[10px] border border-destructive/30 bg-destructive/8 px-3 py-2.5 text-[12.5px] text-destructive"
        >
          {error}
        </div>
      ) : null}
      {children}
      {footer ? (
        <div className="mt-6 space-y-2 text-center text-[11.5px] text-ink-tertiary">
          {footer}
        </div>
      ) : null}
    </div>
  )
}

export default AuthFormLayout
