import * as React from "react"

import { cn } from "@/lib/utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground caret-signal transition-colors duration-[160ms] file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-ink-tertiary focus-visible:border-signal disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:opacity-60",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
