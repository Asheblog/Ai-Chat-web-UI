import { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface MainContentProps {
  children: ReactNode
  className?: string
}

export function MainContent({ children, className }: MainContentProps) {
  return (
    <main className={cn("flex-1 flex flex-col overflow-hidden min-h-0 min-w-0", className)}>
      {children}
    </main>
  )
}
