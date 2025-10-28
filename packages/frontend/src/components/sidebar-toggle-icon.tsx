import * as React from "react"
import { cn } from "@/lib/utils"

interface SidebarToggleIconProps extends React.SVGProps<SVGSVGElement> {
  className?: string
}

/**
 * 侧边栏折叠/展开通用图标 —— 外框 + 居中竖线
 * 与平台其他按钮保持一致的 24px 视图盒。
 */
export const SidebarToggleIcon = React.forwardRef<SVGSVGElement, SidebarToggleIconProps>(
  ({ className, ...props }, ref) => (
    <svg
      ref={ref}
      className={cn("stroke-current", className)}
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect x={5} y={5.5} width={14} height={13} rx={3.5} />
      <path d="M12 7.5v9" />
    </svg>
  )
)
SidebarToggleIcon.displayName = "SidebarToggleIcon"
