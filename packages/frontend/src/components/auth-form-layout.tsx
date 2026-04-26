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
      <div className="v2-panel bg-white/95 p-5 shadow-[0_22px_54px_rgba(15,23,42,0.12)] sm:p-6">
        <div className="mb-7 text-center">
          <h2 className="text-[26px] font-semibold tracking-tight text-slate-900">{title}</h2>
          {description ? (
            <p className="mt-3 text-sm text-slate-500">{description}</p>
          ) : null}
        </div>
        {error ? (
          <div className="mb-5 rounded-[8px] border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-600">
            {error}
          </div>
        ) : null}
        {children}
      </div>
      {footer ? (
        <div className="mt-6 space-y-2 text-center text-sm text-slate-500">
          {footer}
        </div>
      ) : null}
    </div>
  )
}

export default AuthFormLayout
