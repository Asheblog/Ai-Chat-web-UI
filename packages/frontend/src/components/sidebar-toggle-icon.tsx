import * as React from "react"
import { cn } from "@/lib/utils"

interface SidebarToggleIconProps extends React.SVGProps<SVGSVGElement> {
  className?: string
}

type SidebarToggleIntent = "collapse" | "expand"

const SidebarToggleGlyph = React.forwardRef<
  SVGSVGElement,
  SidebarToggleIconProps & { intent: SidebarToggleIntent }
>(({ className, intent, ...props }, ref) => {
  const arrowPath = intent === "collapse"
    ? "M16.9 8.6 13.5 12l3.4 3.4"
    : "M13.5 8.6 16.9 12l-3.4 3.4"
  const arrowMotion = intent === "collapse"
    ? "group-hover/sidebar-toggle:-translate-x-0.5"
    : "group-hover/sidebar-toggle:translate-x-0.5"

  return (
    <svg
      ref={ref}
      className={cn("stroke-current", className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect x={3.25} y={5.5} width={3.1} height={13} rx={1.55} fill="hsl(var(--primary))" opacity={0.14} stroke="none" />
      <rect x={3.25} y={5.5} width={3.1} height={13} rx={1.55} opacity={0.38} />
      <path
        d="M9.6 4.55h6.75a4.2 4.2 0 0 1 4.2 4.2v6.5a4.2 4.2 0 0 1-4.2 4.2H9.6a2.3 2.3 0 0 1-2.3-2.3v-10.3a2.3 2.3 0 0 1 2.3-2.3Z"
        fill="currentColor"
        opacity={0.07}
        stroke="none"
      />
      <path
        d="M9.6 4.55h6.75a4.2 4.2 0 0 1 4.2 4.2v6.5a4.2 4.2 0 0 1-4.2 4.2H9.6a2.3 2.3 0 0 1-2.3-2.3v-10.3a2.3 2.3 0 0 1 2.3-2.3Z"
        opacity={0.68}
      />
      <path
        className={cn("transition-transform duration-200 ease-out", arrowMotion)}
        d={arrowPath}
        stroke="hsl(var(--primary))"
        strokeWidth={2.35}
      />
    </svg>
  )
})
SidebarToggleGlyph.displayName = "SidebarToggleGlyph"

export const SidebarCollapseIcon = React.forwardRef<SVGSVGElement, SidebarToggleIconProps>(
  (props, ref) => <SidebarToggleGlyph ref={ref} intent="collapse" {...props} />
)
SidebarCollapseIcon.displayName = "SidebarCollapseIcon"

export const SidebarExpandIcon = React.forwardRef<SVGSVGElement, SidebarToggleIconProps>(
  (props, ref) => <SidebarToggleGlyph ref={ref} intent="expand" {...props} />
)
SidebarExpandIcon.displayName = "SidebarExpandIcon"

export const SidebarToggleIcon = React.forwardRef<SVGSVGElement, SidebarToggleIconProps>(
  (props, ref) => <SidebarExpandIcon ref={ref} {...props} />
)
SidebarToggleIcon.displayName = "SidebarToggleIcon"
