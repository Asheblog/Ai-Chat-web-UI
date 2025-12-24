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
        <div className="w-full px-4 md:px-8 lg:px-12">
            <nav aria-label="Progress" className="w-full">
                <ol className="flex items-center justify-between w-full">
                    {steps.map((step, index) => {
                        const status = getStepStatus(step.key)
                        const Icon = step.icon
                        const isClickable = !isRunning && stepOrder[step.key] <= currentIndex
                        const isLast = index === steps.length - 1

                        return (
                            <li key={step.key} className={cn("flex items-center", !isLast && "flex-1")}>
                                {/* Step Circle */}
                                <button
                                    type="button"
                                    onClick={() => handleStepClick(step.key)}
                                    disabled={!isClickable}
                                    className={cn(
                                        'group relative flex items-center justify-center flex-shrink-0',
                                        isClickable && 'cursor-pointer',
                                        !isClickable && 'cursor-default'
                                    )}
                                >
                                    <span
                                        className={cn(
                                            'flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all duration-300',
                                            status === 'completed' && 'border-primary bg-primary text-primary-foreground',
                                            status === 'current' && 'border-primary bg-primary/10 text-primary animate-pulse',
                                            status === 'upcoming' && 'border-muted-foreground/30 bg-muted text-muted-foreground'
                                        )}
                                    >
                                        {status === 'completed' ? (
                                            <Check className="h-5 w-5" />
                                        ) : (
                                            <Icon className="h-5 w-5" />
                                        )}
                                    </span>

                                    {/* Label */}
                                    <span
                                        className={cn(
                                            'absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs font-medium transition-colors',
                                            status === 'completed' && 'text-primary',
                                            status === 'current' && 'text-primary',
                                            status === 'upcoming' && 'text-muted-foreground'
                                        )}
                                    >
                                        {step.label}
                                    </span>
                                </button>

                                {/* Connector Line */}
                                {index < steps.length - 1 && (
                                    <div
                                        className={cn(
                                            'mx-3 h-0.5 flex-1 min-w-[2rem] transition-colors duration-500',
                                            stepOrder[steps[index + 1].key] <= currentIndex
                                                ? 'bg-primary'
                                                : 'bg-muted-foreground/30'
                                        )}
                                    >
                                        {/* Animated flow effect for active connector */}
                                        {status === 'current' && (
                                            <div className="h-full w-full overflow-hidden">
                                                <div className="h-full w-full animate-flow-line bg-gradient-to-r from-transparent via-primary to-transparent" />
                                            </div>
                                        )}
                                    </div>
                                )}
                            </li>
                        )
                    })}
                </ol>
            </nav>
        </div>
    )
}
