'use client'

import { useEffect, useRef } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { CustomRequestEditor } from '@/components/chat/custom-request-editor'
import { ModelSelector } from '@/components/model-selector'
import { useModelsStore, type ModelItem } from '@/store/models-store'
import { useSettingsStore } from '@/store/settings-store'
import { ChevronRight, X } from 'lucide-react'
import type { JudgeConfig, ModelConfigState, UseBattleFlowReturn } from '../hooks/useBattleFlow'

interface ConfigStepProps {
    selectedModels: ModelConfigState[]
    judgeConfig: JudgeConfig
    onAddModel: (model: ModelItem) => void
    onRemoveModel: (key: string) => void
    onUpdateModelConfig: (key: string, updater: (item: ModelConfigState) => ModelConfigState) => void
    onJudgeConfigChange: (config: JudgeConfig) => void
    onNext: () => void
    canProceed: boolean
}

export function ConfigStep({
    selectedModels,
    judgeConfig,
    onAddModel,
    onRemoveModel,
    onUpdateModelConfig,
    onJudgeConfigChange,
    onNext,
    canProceed,
}: ConfigStepProps) {
    const { models, fetchAll } = useModelsStore()
    const { systemSettings, fetchSystemSettings, settingsLoading } = useSettingsStore((state) => ({
        systemSettings: state.systemSettings,
        fetchSystemSettings: state.fetchSystemSettings,
        settingsLoading: state.isLoading,
    }))
    const settingsRequestedRef = useRef(false)

    useEffect(() => {
        if (models.length === 0) {
            fetchAll().catch(() => { })
        }
    }, [models.length, fetchAll])

    useEffect(() => {
        if (systemSettings || settingsLoading || settingsRequestedRef.current) return
        settingsRequestedRef.current = true
        fetchSystemSettings().catch(() => {
            settingsRequestedRef.current = false
        })
    }, [systemSettings, settingsLoading, fetchSystemSettings])

    const toolAvailability = (model: ModelItem) => {
        const provider = (model.provider || '').toLowerCase()
        const providerSupportsTools = provider === 'openai' || provider === 'azure_openai'
        const isWebSearchCapable = typeof model.capabilities?.web_search === 'boolean' ? model.capabilities.web_search : true
        const isPythonCapable = typeof model.capabilities?.code_interpreter === 'boolean' ? model.capabilities.code_interpreter : true

        const canUseWebSearch =
            Boolean(systemSettings?.webSearchAgentEnable && systemSettings?.webSearchHasApiKey) &&
            providerSupportsTools &&
            isWebSearchCapable

        const canUsePython =
            Boolean(systemSettings?.pythonToolEnable) &&
            providerSupportsTools &&
            isPythonCapable

        const webSearchDisabledNote = !systemSettings?.webSearchAgentEnable
            ? '管理员未启用联网搜索'
            : !systemSettings?.webSearchHasApiKey
                ? '尚未配置搜索 API Key'
                : !providerSupportsTools
                    ? '当前连接不支持工具调用'
                    : !isWebSearchCapable
                        ? '当前模型未开放联网搜索'
                        : undefined

        const pythonDisabledNote = !systemSettings?.pythonToolEnable
            ? '管理员未开启 Python 工具'
            : !providerSupportsTools
                ? '当前连接不支持工具调用'
                : !isPythonCapable
                    ? '当前模型未启用 Python 工具'
                    : undefined

        return {
            canUseWebSearch,
            canUsePython,
            webSearchDisabledNote,
            pythonDisabledNote,
        }
    }

    return (
        <div className="space-y-6 w-full">
            {/* Model Selection */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                        选择参赛模型
                        <Badge variant="outline">{selectedModels.length}/8</Badge>
                    </CardTitle>
                    <CardDescription>最多选择 8 个模型参与对战，每个模型可单独配置</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <ModelSelector
                        selectedModelId={null}
                        onModelChange={onAddModel}
                        className="w-full justify-between"
                    />

                    {selectedModels.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border/70 p-8 text-center">
                            <p className="text-sm text-muted-foreground">点击上方选择器添加参赛模型</p>
                        </div>
                    ) : (
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {selectedModels.map((item) => {
                                const availability = toolAvailability(item.model)
                                return (
                                    <div
                                        key={item.key}
                                        className="rounded-xl border border-border/70 p-4 space-y-3 hover:border-primary/50 transition-colors"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <div className="font-medium text-sm">{item.model.name}</div>
                                                <div className="text-xs text-muted-foreground">{item.model.provider}</div>
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6"
                                                onClick={() => onRemoveModel(item.key)}
                                            >
                                                <X className="h-4 w-4" />
                                            </Button>
                                        </div>

                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs text-muted-foreground">联网搜索</span>
                                                <Switch
                                                    checked={item.webSearchEnabled && availability.canUseWebSearch}
                                                    disabled={!availability.canUseWebSearch}
                                                    onCheckedChange={(checked) =>
                                                        onUpdateModelConfig(item.key, (prev) => ({
                                                            ...prev,
                                                            webSearchEnabled: Boolean(checked),
                                                        }))
                                                    }
                                                />
                                            </div>
                                            {availability.webSearchDisabledNote && (
                                                <p className="text-[11px] text-muted-foreground">{availability.webSearchDisabledNote}</p>
                                            )}

                                            <div className="flex items-center justify-between">
                                                <span className="text-xs text-muted-foreground">Python 工具</span>
                                                <Switch
                                                    checked={item.pythonEnabled && availability.canUsePython}
                                                    disabled={!availability.canUsePython}
                                                    onCheckedChange={(checked) =>
                                                        onUpdateModelConfig(item.key, (prev) => ({
                                                            ...prev,
                                                            pythonEnabled: Boolean(checked),
                                                        }))
                                                    }
                                                />
                                            </div>
                                            {availability.pythonDisabledNote && (
                                                <p className="text-[11px] text-muted-foreground">{availability.pythonDisabledNote}</p>
                                            )}

                                            <Separator className="my-2" />

                                            {/* Reasoning Mode Toggle */}
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs text-muted-foreground">思考模式</span>
                                                <Switch
                                                    checked={item.reasoningEnabled}
                                                    onCheckedChange={(checked) =>
                                                        onUpdateModelConfig(item.key, (prev) => ({
                                                            ...prev,
                                                            reasoningEnabled: Boolean(checked),
                                                        }))
                                                    }
                                                />
                                            </div>

                                            {/* Reasoning Effort Selector - only show when reasoning is enabled */}
                                            {item.reasoningEnabled && (
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs text-muted-foreground">思考强度</span>
                                                    <Select
                                                        value={item.reasoningEffort}
                                                        onValueChange={(v) =>
                                                            onUpdateModelConfig(item.key, (prev) => ({
                                                                ...prev,
                                                                reasoningEffort: v as 'low' | 'medium' | 'high',
                                                            }))
                                                        }
                                                    >
                                                        <SelectTrigger className="w-24 h-7 text-xs">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="low">低</SelectItem>
                                                            <SelectItem value="medium">中</SelectItem>
                                                            <SelectItem value="high">高</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            )}

                                            {/* Ollama Think Toggle */}
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs text-muted-foreground">Ollama Think</span>
                                                <Switch
                                                    checked={item.ollamaThink}
                                                    onCheckedChange={(checked) =>
                                                        onUpdateModelConfig(item.key, (prev) => ({
                                                            ...prev,
                                                            ollamaThink: Boolean(checked),
                                                        }))
                                                    }
                                                />
                                            </div>
                                        </div>

                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="w-full"
                                            onClick={() =>
                                                onUpdateModelConfig(item.key, (prev) => ({
                                                    ...prev,
                                                    advancedOpen: !prev.advancedOpen,
                                                }))
                                            }
                                        >
                                            {item.advancedOpen ? '收起高级请求' : '高级请求配置'}
                                        </Button>

                                        {item.advancedOpen && (
                                            <CustomRequestEditor
                                                customHeaders={item.customHeaders}
                                                onAddHeader={() =>
                                                    onUpdateModelConfig(item.key, (prev) => ({
                                                        ...prev,
                                                        customHeaders: [...prev.customHeaders, { name: '', value: '' }],
                                                    }))
                                                }
                                                onHeaderChange={(index, field, value) =>
                                                    onUpdateModelConfig(item.key, (prev) => ({
                                                        ...prev,
                                                        customHeaders: prev.customHeaders.map((h, i) =>
                                                            i === index ? { ...h, [field]: value } : h
                                                        ),
                                                    }))
                                                }
                                                onRemoveHeader={(index) =>
                                                    onUpdateModelConfig(item.key, (prev) => ({
                                                        ...prev,
                                                        customHeaders: prev.customHeaders.filter((_, i) => i !== index),
                                                    }))
                                                }
                                                canAddHeader={item.customHeaders.length < 10}
                                                customBody={item.customBody}
                                                onCustomBodyChange={(value) =>
                                                    onUpdateModelConfig(item.key, (prev) => ({
                                                        ...prev,
                                                        customBody: value,
                                                        customBodyError: null,
                                                    }))
                                                }
                                                customBodyError={item.customBodyError}
                                            />
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Judge Configuration */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">裁判设置</CardTitle>
                    <CardDescription>配置裁判模型和评判规则</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label>裁判模型</Label>
                        <ModelSelector
                            selectedModelId={judgeConfig.model?.id || null}
                            onModelChange={(model) => onJudgeConfigChange({ ...judgeConfig, model })}
                            className="w-full justify-between"
                        />
                    </div>

                    <Separator />

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="space-y-2">
                            <Label>评判阈值</Label>
                            <Input
                                type="text"
                                value={judgeConfig.threshold}
                                onChange={(e) =>
                                    onJudgeConfigChange({
                                        ...judgeConfig,
                                        threshold: Math.min(1, Math.max(0, parseFloat(e.target.value) || 0.8)),
                                    })
                                }
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>运行次数</Label>
                            <Select
                                value={String(judgeConfig.runsPerModel)}
                                onValueChange={(v) =>
                                    onJudgeConfigChange({ ...judgeConfig, runsPerModel: parseInt(v, 10) })
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="1">1</SelectItem>
                                    <SelectItem value="2">2</SelectItem>
                                    <SelectItem value="3">3</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>pass@k</Label>
                            <Select
                                value={String(judgeConfig.passK)}
                                onValueChange={(v) =>
                                    onJudgeConfigChange({ ...judgeConfig, passK: parseInt(v, 10) })
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="1">1</SelectItem>
                                    <SelectItem value="2">2</SelectItem>
                                    <SelectItem value="3">3</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>并发数</Label>
                            <Input
                                type="text"
                                value={judgeConfig.maxConcurrency}
                                onChange={(e) =>
                                    onJudgeConfigChange({
                                        ...judgeConfig,
                                        maxConcurrency: Math.min(6, Math.max(1, parseInt(e.target.value, 10) || 3)),
                                    })
                                }
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Next Button */}
            <div className="flex justify-end">
                <Button onClick={onNext} disabled={!canProceed} size="lg" className="gap-2">
                    下一步
                    <ChevronRight className="h-4 w-4" />
                </Button>
            </div>
        </div>
    )
}
