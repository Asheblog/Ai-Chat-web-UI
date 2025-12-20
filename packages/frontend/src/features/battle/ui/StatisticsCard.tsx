'use client'

import { cn } from '@/lib/utils'
import { TrendingUp, Users, Clock, Target } from 'lucide-react'

interface StatisticsCardProps {
    label: string
    value: string | number
    subValue?: string
    icon: 'rate' | 'models' | 'time' | 'target'
    variant?: 'default' | 'success' | 'warning' | 'error'
    progress?: number
}

const iconMap = {
    rate: TrendingUp,
    models: Users,
    time: Clock,
    target: Target,
}

const variantStyles = {
    default: {
        bg: 'from-primary/10 to-primary/5',
        icon: 'text-primary',
        value: 'text-primary',
    },
    success: {
        bg: 'from-green-500/10 to-green-600/5',
        icon: 'text-green-500',
        value: 'text-green-500',
    },
    warning: {
        bg: 'from-amber-500/10 to-amber-600/5',
        icon: 'text-amber-500',
        value: 'text-amber-500',
    },
    error: {
        bg: 'from-red-500/10 to-red-600/5',
        icon: 'text-destructive',
        value: 'text-destructive',
    },
}

export function StatisticsCard({
    label,
    value,
    subValue,
    icon,
    variant = 'default',
    progress,
}: StatisticsCardProps) {
    const Icon = iconMap[icon]
    const styles = variantStyles[variant]

    return (
        <div
            className={cn(
                'relative overflow-hidden rounded-xl border p-4',
                'bg-gradient-to-br',
                styles.bg
            )}
        >
            {/* Background decoration */}
            <div className="absolute -right-4 -top-4 h-16 w-16 rounded-full bg-current opacity-5" />

            <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <Icon className={cn('h-4 w-4', styles.icon)} />
                        <span className="text-xs text-muted-foreground font-medium">{label}</span>
                    </div>
                    <div className={cn('text-2xl font-bold', styles.value)}>{value}</div>
                    {subValue && (
                        <div className="text-xs text-muted-foreground">{subValue}</div>
                    )}
                </div>

                {/* Optional progress bar */}
                {progress != null && (
                    <div className="w-16">
                        <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
                            <div
                                className={cn('h-full rounded-full transition-all duration-500', {
                                    'bg-primary': variant === 'default',
                                    'bg-green-500': variant === 'success',
                                    'bg-amber-500': variant === 'warning',
                                    'bg-destructive': variant === 'error',
                                })}
                                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                            />
                        </div>
                        <div className="text-[10px] text-muted-foreground text-right mt-1">
                            {progress.toFixed(0)}%
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
