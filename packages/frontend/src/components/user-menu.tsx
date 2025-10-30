'use client'

import { LogOut, Sun, Moon, Monitor } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useAuthStore } from '@/store/auth-store'
import { useSettingsStore } from '@/store/settings-store'
import { cn } from '@/lib/utils'

interface UserMenuProps {
  variant?: 'label' | 'icon'
  className?: string
}

export function UserMenu({ variant = 'label', className }: UserMenuProps) {
  const { actorState, user, logout } = useAuthStore((state) => ({
    actorState: state.actorState,
    user: state.user,
    logout: state.logout,
  }))
  const { setTheme } = useSettingsStore()

  const handleThemeChange = (mode: 'light' | 'dark' | 'system') => {
    setTheme(mode)
  }

  const showLabel = variant === 'label'

  if (actorState !== 'authenticated' || !user) {
    const button = (
      <Button
        type="button"
        variant="default"
        size={variant === 'icon' ? 'sm' : 'default'}
        className={cn(variant === 'icon' ? 'h-8 px-3' : 'h-9 px-4', className)}
        onClick={() => {
          try {
            window.location.href = '/auth/login'
          } catch {}
        }}
      >
        登录
      </Button>
    )

    if (variant === 'icon') {
      return (
        <div className={cn('flex flex-col items-center', className)}>
          {button}
        </div>
      )
    }

    return (
      <div className={cn('flex items-center', className)}>
        {button}
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            'flex items-center gap-2',
            showLabel ? 'h-9 px-3' : 'h-9 w-9 justify-center',
            className
          )}
          aria-label={showLabel ? undefined : '用户菜单'}
        >
          <Avatar className={cn(showLabel ? 'h-6 w-6' : 'h-7 w-7')}>
            <AvatarImage src={undefined} />
            <AvatarFallback className="text-xs">
              {user?.username?.charAt(0).toUpperCase() || 'U'}
            </AvatarFallback>
          </Avatar>
          {showLabel && (
            <span className="max-w-[140px] truncate text-sm">
              {user?.username || '未登录'}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={() => handleThemeChange('light')}>
          <Sun className="mr-2 h-4 w-4" />
          浅色模式
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleThemeChange('dark')}>
          <Moon className="mr-2 h-4 w-4" />
          深色模式
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleThemeChange('system')}>
          <Monitor className="mr-2 h-4 w-4" />
          跟随系统
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => { logout().catch(() => {}) }} className="text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
