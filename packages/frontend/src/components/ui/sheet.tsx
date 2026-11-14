"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { OVERLAY_SHADOW } from "@/components/ui/surface-styles"

const Sheet = DialogPrimitive.Root
const SheetTrigger = DialogPrimitive.Trigger
const SheetClose = DialogPrimitive.Close
const SheetPortal = DialogPrimitive.Portal

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn("fixed inset-0 z-50 bg-[hsl(var(--foreground)/0.28)] dark:bg-black/60", className)}
    {...props}
  />
))
SheetOverlay.displayName = DialogPrimitive.Overlay.displayName

type SheetContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
  dialogTitle: React.ReactNode
  dialogDescription?: React.ReactNode
}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(
  ({ side = "right", className, children, showCloseButton = true, dialogTitle, dialogDescription, ...props }, ref) => (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed z-50 gap-4 bg-surface p-0 transition ease-in-out",
          OVERLAY_SHADOW,
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          side === "right" &&
            "inset-y-0 right-0 h-full w-80 border-l border-border data-[state=open]:slide-in-from-right-full data-[state=closed]:slide-out-to-right-full data-[state=closed]:duration-300 data-[state=open]:duration-300",
          side === "left" &&
            "inset-y-0 left-0 h-full w-80 border-r border-border data-[state=open]:slide-in-from-left-full data-[state=closed]:slide-out-to-left-full data-[state=closed]:duration-300 data-[state=open]:duration-300",
          side === "top" && "inset-x-0 top-0 w-full border-b border-border",
          side === "bottom" && "inset-x-0 bottom-0 w-full border-t border-border",
          className
        )}
        {...props}
      >
        <DialogPrimitive.Title className="sr-only">{dialogTitle}</DialogPrimitive.Title>
        {dialogDescription && (
          <DialogPrimitive.Description className="sr-only">{dialogDescription}</DialogPrimitive.Description>
        )}
        {showCloseButton && (
          <SheetClose className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full border border-transparent text-ink-tertiary transition-colors duration-[160ms] hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none sm:right-4 sm:top-4 sm:h-8 sm:w-8 sm:rounded-md">
            <X className="h-5 w-5 sm:h-4 sm:w-4" />
            <span className="sr-only">Close</span>
          </SheetClose>
        )}
        {children}
      </DialogPrimitive.Content>
    </SheetPortal>
  )
)
SheetContent.displayName = DialogPrimitive.Content.displayName

export { Sheet, SheetTrigger, SheetClose, SheetContent }
