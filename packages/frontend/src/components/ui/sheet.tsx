"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

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
    className={cn("fixed inset-0 z-50 bg-black/50 backdrop-blur-sm", className)}
    {...props}
  />
))
SheetOverlay.displayName = DialogPrimitive.Overlay.displayName

type SheetContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
  dialogTitle: React.ReactNode
}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(
  ({ side = "right", className, children, showCloseButton = true, dialogTitle, ...props }, ref) => (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed z-50 gap-4 bg-background p-0 shadow-lg transition ease-in-out",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          side === "right" &&
            "inset-y-0 right-0 h-full w-80 border-l data-[state=open]:slide-in-from-right-full data-[state=closed]:slide-out-to-right-full data-[state=closed]:duration-300 data-[state=open]:duration-300",
          side === "left" &&
            "inset-y-0 left-0 h-full w-80 border-r data-[state=open]:slide-in-from-left-full data-[state=closed]:slide-out-to-left-full data-[state=closed]:duration-300 data-[state=open]:duration-300",
          side === "top" && "inset-x-0 top-0 w-full border-b",
          side === "bottom" && "inset-x-0 bottom-0 w-full border-t",
          className
        )}
        {...props}
      >
        <DialogPrimitive.Title className="sr-only">{dialogTitle}</DialogPrimitive.Title>
        {showCloseButton && (
          <SheetClose className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full opacity-70 ring-offset-background transition-opacity hover:opacity-100 hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none sm:right-4 sm:top-4 sm:h-8 sm:w-8 sm:rounded-sm sm:hover:bg-transparent">
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
