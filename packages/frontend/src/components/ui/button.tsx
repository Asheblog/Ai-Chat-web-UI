import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-[calc(var(--radius)-2px)] border border-transparent text-sm font-medium ring-offset-background transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:saturate-50",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_1px_2px_hsl(var(--primary)/0.35)] hover:bg-[hsl(var(--primary-hover))] active:translate-y-[1px]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[0_1px_2px_hsl(var(--destructive)/0.35)] hover:bg-destructive/90 active:translate-y-[1px]",
        outline:
          "border-border/90 bg-[hsl(var(--surface)/0.65)] text-foreground hover:bg-[hsl(var(--surface-hover))] hover:text-foreground",
        secondary:
          "border-border/70 bg-secondary text-secondary-foreground hover:bg-[hsl(var(--surface-hover))] hover:text-foreground",
        ghost:
          "text-muted-foreground hover:bg-[hsl(var(--surface-hover))] hover:text-foreground data-[state=open]:bg-[hsl(var(--surface-hover))]",
        link: "border-transparent text-primary underline-offset-4 hover:text-[hsl(var(--primary-hover))] hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3",
        lg: "h-11 px-8",
        icon: "h-10 w-10",
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
