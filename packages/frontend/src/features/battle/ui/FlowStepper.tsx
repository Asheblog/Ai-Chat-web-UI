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

    const getStepStatus = (stepKey: BattleStep): 'completed' | 'current' | 'upcoming' => {
        const stepIndex = stepOrder[stepKey]
        if (stepIndex < currentIndex) return 'completed'
        if (stepIndex === currentIndex) return 'current'
        return 'upcoming'
    }

    const handleStepClick = (step: BattleStep) => {
        if (isRunning) return
        const stepIndex = stepOrder[step]
        // Only allow clicking on completed steps or current step
        if (stepIndex <= currentIndex && onStepClick) {
            onStepClick(step)
        }
    }

    return (
        <div className="w-full">
            <nav aria-label="Progress" className="v2-panel overflow-hidden">
                <ol className="grid grid-cols-4">
                    {steps.map((step, index) => {
                        const status = getStepStatus(step.key)
                        const Icon = step.icon
                        const isClickable = !isRunning && stepOrder[step.key] <= currentIndex

                        return (
                            <li key={step.key} className="min-w-0">
                                <button
                                    type="button"
                                    onClick={() => handleStepClick(step.key)}
                                    disabled={!isClickable}
                                    className={cn(
                                        'group relative flex h-12 w-full items-center justify-center gap-2 border-r border-border px-2 text-sm transition last:border-r-0',
                                        status === 'completed' && 'bg-card text-foreground',
                                        status === 'current' && 'bg-accent text-primary',
                                        status === 'upcoming' && 'bg-card/70 text-muted-foreground',
                                        isClickable && 'cursor-pointer',
                                        !isClickable && 'cursor-default'
                                    )}
                                >
                                    <span className={cn(
                                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                                        status === 'completed' && 'bg-primary text-primary-foreground',
                                        status === 'current' && 'bg-primary text-primary-foreground',
                                        status === 'upcoming' && 'bg-muted text-muted-foreground'
                                    )}>
                                        {status === 'completed' ? (
                                            <Check className="h-4 w-4" />
                                        ) : (
                                            index + 1
                                        )}
                                    </span>
                                    <Icon className="hidden h-4 w-4 sm:block" />
                                    <span className="hidden truncate sm:inline">
                                        {index + 1}. {step.label}
                                    </span>
                                </button>
                            </li>
                        )
                    })}
                </ol>
            </nav>
        </div>
    )
}
