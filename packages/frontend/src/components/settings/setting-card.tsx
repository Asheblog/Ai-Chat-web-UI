import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface SettingCardProps {
  children: React.ReactNode
  className?: string
}

/**
 * 设置页面统一的卡片容器组件
 *
 * 特点：
 * - 响应式布局：小屏幕纵向，大屏幕横向
 * - 统一的内边距和间距
 * - Hover 效果
 * - 完整的样式一致性
 */
export function SettingCard({ children, className }: SettingCardProps) {
  return (
    <Card
      className={cn(
        "flex flex-col sm:flex-row sm:items-center sm:justify-between",
        "gap-4 sm:gap-6",
        "px-4 py-4 sm:px-5 sm:py-5",
        "transition-all hover:border-primary/30 hover:shadow-sm",
        className
      )}
    >
      {children}
    </Card>
  )
}

/**
 * 设置项内容区域（左侧）
 */
export function SettingCardContent({ children }: { children: React.ReactNode }) {
  return <div className="flex-1">{children}</div>
}

/**
 * 设置项控制区域（右侧）
 */
export function SettingCardControl({ children }: { children: React.ReactNode }) {
  return <div className="shrink-0 self-start sm:self-auto">{children}</div>
}

/**
 * 设置项标题
 */
export function SettingCardTitle({ children }: { children: React.ReactNode }) {
  return <div className="font-medium">{children}</div>
}

/**
 * 设置项描述
 */
export function SettingCardDescription({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-muted-foreground mt-1.5">{children}</div>
}
