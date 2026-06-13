'use client'

import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { COMPOSER_SHELL_BASE_CLASS } from './composer-shell-styles'

interface ComposerShellProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

export function ComposerShell({ children, className, ...props }: ComposerShellProps) {
  return (
    <div className={cn(COMPOSER_SHELL_BASE_CLASS, 'relative p-4', className)} {...props}>
      {children}
    </div>
  )
}
