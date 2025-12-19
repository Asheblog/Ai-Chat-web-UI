'use client'

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { Check, X, Loader2, AlertCircle, Scale } from 'lucide-react'
import type { NodeState, NodeStatus } from '../hooks/useBattleFlow'

interface ModelNodeProps {
    modelLabel: string
    status: NodeStatus
    attemptIndex?: number
    durationMs?: number | null
    onClick?: () => void
    isSelected?: boolean
}

const statusConfig: Record<NodeStatus, {
    icon: React.ComponentType<{ className?: string }>
    iconClass: string
    borderClass: string
    bgClass: string
    animationClass: string
}> = {
    pending: {
        icon: () => <div className="w-2 h-2 rounded-full bg-muted-foreground/50" />,
        iconClass: '',
        borderClass: 'border-muted-foreground/30 border-dashed',
        bgClass: 'bg-muted/50',
        animationClass: '',
    },
    running: {
        icon: Loader2,
        iconClass: 'text-primary animate-spin',
        borderClass: 'border-primary',
        bgClass: 'bg-primary/10',
        animationClass: 'animate-node-pulse',
    },
    success: {
        icon: Check,
        iconClass: 'text-green-500',
        borderClass: 'border-green-500',
        bgClass: 'bg-green-500/10',
        animationClass: 'animate-node-bounce',
    },
    error: {
        icon: X,
        iconClass: 'text-destructive',
        borderClass: 'border-destructive',
        bgClass: 'bg-destructive/10',
        animationClass: 'animate-node-shake',
    },
    judging: {
        icon: Scale,
        iconClass: 'text-yellow-500 animate-pulse',
        borderClass: 'border-yellow-500',
        bgClass: 'bg-yellow-500/10',
        animationClass: '',
    },
}

export function ModelNode({
    modelLabel,
    status,
    attemptIndex,
    durationMs,
    onClick,
    isSelected = false,
}: ModelNodeProps) {
    const config = statusConfig[status]
    const Icon = config.icon

    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'relative flex flex-col items-center justify-center gap-1',
                'rounded-xl border-2 p-3 min-w-[100px] min-h-[80px]',
                'transition-all duration-300 hover:scale-105',
                config.borderClass,
                config.bgClass,
                config.animationClass,
                isSelected && 'ring-2 ring-primary ring-offset-2',
                onClick && 'cursor-pointer'
            )}
        >
            {/* Status Icon */}
            <div className={cn('flex items-center justify-center h-6 w-6', config.iconClass)}>
                <Icon className="h-5 w-5" />
            </div>

            {/* Model Name */}
            <div className="text-xs font-medium text-center line-clamp-2 max-w-[90px]">
                {modelLabel}
            </div>

            {/* Duration / Attempt */}
            <div className="text-[10px] text-muted-foreground">
                {attemptIndex && `#${attemptIndex}`}
                {durationMs != null && ` · ${(durationMs / 1000).toFixed(1)}s`}
            </div>

            {/* Status indicator pulse for running */}
            {status === 'running' && (
                <div className="absolute -top-1 -right-1">
                    <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-primary" />
                    </span>
                </div>
            )}
        </button>
    )
}

interface FlowGraphProps {
    judgeLabel: string
    nodeStates: Map<string, NodeState[]>
    selectedNodeKey?: string
    onNodeClick?: (modelKey: string, attemptIndex: number) => void
    isRunning?: boolean
}

export function FlowGraph({
    judgeLabel,
    nodeStates,
    selectedNodeKey,
    onNodeClick,
    isRunning = false,
}: FlowGraphProps) {
    const modelKeys = useMemo(() => Array.from(nodeStates.keys()), [nodeStates])

    // Calculate progress
    const progress = useMemo(() => {
        let total = 0
        let completed = 0
        nodeStates.forEach((attempts) => {
            total += attempts.length
            completed += attempts.filter((a) =>
                a.status === 'success' || a.status === 'error'
            ).length
        })
        return { total, completed, percentage: total > 0 ? (completed / total) * 100 : 0 }
    }, [nodeStates])

    return (
        <div className="flex flex-col items-center gap-6 battle-flow-graph">
            {/* Judge Node */}
            <div className="flex flex-col items-center gap-2">
                <div className={cn(
                    'flex items-center justify-center gap-2 px-4 py-2 rounded-xl',
                    'border-2 border-primary bg-primary/10'
                )}>
                    <Scale className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">{judgeLabel}</span>
                </div>
                <div className="text-xs text-muted-foreground">裁判模型</div>
            </div>

            {/* Connection Lines */}
            <div className="relative w-full flex justify-center">
                <svg
                    className="absolute top-0 left-1/2 -translate-x-1/2"
                    width="100%"
                    height="40"
                    style={{ maxWidth: `${Math.min(modelKeys.length * 140, 800)}px` }}
                >
                    {modelKeys.map((_, index) => {
                        const totalWidth = modelKeys.length * 140
                        const startX = totalWidth / 2
                        const endX = index * 140 + 70

                        return (
                            <path
                                key={index}
                                d={`M ${startX} 0 Q ${startX} 20, ${endX} 40`}
                                fill="none"
                                stroke="hsl(var(--muted-foreground) / 0.3)"
                                strokeWidth="2"
                                strokeDasharray={isRunning ? "5,5" : "0"}
                                className={isRunning ? "animate-dash-flow" : ""}
                            />
                        )
                    })}
                </svg>
                <div className="h-10" />
            </div>

            {/* Model Nodes Grid */}
            <div className="flex flex-wrap justify-center gap-4 max-w-4xl">
                {modelKeys.map((modelKey) => {
                    const attempts = nodeStates.get(modelKey) || []
                    return (
                        <div key={modelKey} className="flex flex-col items-center gap-2">
                            {attempts.map((attempt) => (
                                <ModelNode
                                    key={`${modelKey}-${attempt.attemptIndex}`}
                                    modelLabel={attempt.modelLabel}
                                    status={attempt.status}
                                    attemptIndex={attempt.attemptIndex}
                                    durationMs={attempt.durationMs}
                                    onClick={() => onNodeClick?.(modelKey, attempt.attemptIndex)}
                                    isSelected={selectedNodeKey === `${modelKey}-${attempt.attemptIndex}`}
                                />
                            ))}
                        </div>
                    )
                })}
            </div>

            {/* Progress Bar */}
            <div className="w-full max-w-md space-y-2">
                <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">执行进度</span>
                    <span className="font-medium">{progress.completed}/{progress.total}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                        className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${progress.percentage}%` }}
                    />
                </div>
            </div>
        </div>
    )
}
