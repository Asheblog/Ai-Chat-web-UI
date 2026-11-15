import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"
import { cn } from "@/lib/utils"

// Ink & Mist：轨道 38×22，圆钮18；children 为整行开关提供标题/说明。
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, children, ...props }, ref) => {
  const thumb = <SwitchPrimitives.Thumb className={cn(
    "pointer-events-none block h-[18px] w-[18px] rounded-full bg-surface transition-transform duration-[160ms]",
    "data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-[2px]",
    "data-[state=checked]:bg-background",
  )} />
  return (
    <SwitchPrimitives.Root
      className={cn(
        children
          ? "peer group inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer items-center"
          : "peer inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-[160ms] border-border bg-surface-hover data-[state=checked]:border-transparent data-[state=checked]:bg-signal",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
      ref={ref}
    >
      {children}
      {children ? <span
        aria-hidden="true"
        data-slot="switch-track"
        className="inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full border border-border bg-surface-hover transition-colors duration-[160ms] group-data-[state=checked]:border-transparent group-data-[state=checked]:bg-signal"
      >{thumb}</span> : thumb}
    </SwitchPrimitives.Root>
  )
})
Switch.displayName = SwitchPrimitives.Root.displayName
export { Switch }
