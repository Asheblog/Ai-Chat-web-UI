"use client"
import { ReactNode } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
    <Card className={cn("rounded-3xl shadow-xl md:shadow-lg", className)}>
      <CardHeader className="text-center space-y-2">
        <CardTitle className="text-2xl font-bold">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="mb-4 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
            {error}
          </div>
        ) : null}
        {children}
        {footer ? (
          <div className="mt-6 text-center text-sm space-y-2">
            {footer}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export default AuthFormLayout
