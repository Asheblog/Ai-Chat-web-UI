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
        <div className="mb-6 text-center">
          <h2 className="text-title-l font-semibold tracking-tight text-foreground">{title}</h2>
          {description ? (
            <p className="mt-2 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="mb-5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}
      {children}
      {footer ? (
        <div className="mt-6 space-y-2 text-center text-sm text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </div>
  )
}

export default AuthFormLayout
