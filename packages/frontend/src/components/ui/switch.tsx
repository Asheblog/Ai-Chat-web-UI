import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

// Ink & Mist：轨道 38×22，选中用信号色，未选中用表面色 + 发丝线，白色圆钮 18。
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-[160ms]",
      "border-border bg-surface-hover",
      "data-[state=checked]:border-transparent data-[state=checked]:bg-signal",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-[18px] w-[18px] rounded-full bg-surface transition-transform duration-[160ms]",
        "data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-[2px]",
        "data-[state=checked]:bg-background"
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
