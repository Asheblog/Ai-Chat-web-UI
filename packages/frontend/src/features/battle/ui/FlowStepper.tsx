'use client'

import { cn } from '@/lib/utils'
import { Check, Settings, FileText, Play, Trophy } from 'lucide-react'
import type { BattleStep } from '../hooks/useBattleFlow'

interface FlowStepperProps {
    currentStep: BattleStep
    onStepClick?: (step: BattleStep) => void
    isRunning?: boolean
}

interface StepConfig {
    key: BattleStep
    label: string
    icon: React.ComponentType<{ className?: string }>
}

const steps: StepConfig[] = [
    { key: 'config', label: '配置', icon: Settings },
    { key: 'prompt', label: '题目', icon: FileText },
    { key: 'execution', label: '执行', icon: Play },
    { key: 'result', label: '结果', icon: Trophy },
]

const stepOrder: Record<BattleStep, number> = {
    config: 0,
    prompt: 1,
    execution: 2,
    result: 3,
}

export function FlowStepper({ currentStep, onStepClick, isRunning = false }: FlowStepperProps) {
    const currentIndex = stepOrder[currentStep]

    const handleStepClick = (step: BattleStep) => {
        if (isRunning) return
        // 只允许回看已完成的步骤与当前步骤
        if (stepOrder[step] <= currentIndex) {
            onStepClick?.(step)
        }
    }

    return (
        <nav aria-label="对战进度" className="border-b border-border">
            <ol className="flex items-center gap-1">
                {steps.map((step) => {
                    const index = stepOrder[step.key]
                    const isCurrent = index === currentIndex
                    const isCompleted = index < currentIndex
                    const isClickable = !isRunning && index <= currentIndex
                    const Icon = step.icon
                    return (
                        <li key={step.key} className="min-w-0">
                            <button
                                type="button"
                                onClick={() => handleStepClick(step.key)}
                                disabled={!isClickable}
                                aria-current={isCurrent ? 'step' : undefined}
                                className={cn(
                                    'relative inline-flex h-11 items-center gap-2 px-3 text-[13px] transition-colors duration-[160ms]',
                                    isCurrent ? 'font-medium text-foreground' : 'text-ink-tertiary',
                                    isClickable && !isCurrent && 'hover:text-foreground',
                                    !isClickable && 'cursor-default',
                                )}
                            >
                                {isCompleted ? (
                                    <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                ) : (
                                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                                )}
                                <span className="whitespace-nowrap">{step.label}</span>
                                <span className="sr-only">
                                    {isCompleted ? '（已完成）' : isCurrent ? '（当前步骤）' : '（未开始）'}
                                </span>
                                {isCurrent ? (
                                    <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-signal" aria-hidden />
                                ) : null}
                            </button>
                        </li>
                    )
                })}
            </ol>
        </nav>
    )
}
