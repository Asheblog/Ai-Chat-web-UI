import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// Ink & Mist：主操作 = 墨黑（fg/bg 反转），AI 动作才用 signal，其余靠发丝线区分层级。
const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md border border-transparent text-[13px] font-medium transition-colors duration-[160ms] disabled:pointer-events-none disabled:border-transparent disabled:bg-surface-subtle disabled:text-ink-tertiary",
  {
    variants: {
      variant: {
        default: "bg-foreground text-background hover:bg-[hsl(var(--foreground)/0.9)]",
        destructive: "bg-destructive text-destructive-foreground hover:bg-[hsl(var(--destructive)/0.9)]",
        outline:
          "border-border bg-transparent text-foreground hover:bg-surface-hover",
        outlineInverse:
          "border-borderStrong bg-transparent text-foreground hover:border-foreground/30 hover:bg-surface-hover",
        secondary:
          "border-border bg-surface text-foreground hover:bg-surface-subtle",
        ghost:
          "text-muted-foreground hover:bg-surface-hover hover:text-foreground data-[state=open]:bg-surface-hover data-[state=open]:text-foreground disabled:bg-transparent",
        link: "text-signal underline-offset-4 hover:underline disabled:bg-transparent",
      },
      size: {
        default: "h-9 px-4",
        xs: "h-7 rounded-sm px-2.5 text-xs",
        sm: "h-8 px-3",
        lg: "h-10 px-6",
        icon: "h-8 w-8",
        "icon-xs": "h-7 w-7 rounded-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
