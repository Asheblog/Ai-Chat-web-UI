import { Bot, Gauge, SlidersHorizontal } from 'lucide-react'
import { ModelSelector } from '@/components/model-selector'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ModelItem } from '@/store/models-store'

interface SingleModelBattleConfigPanelProps {
  modelKey: string
  judgeKey: string
  judgeThreshold: string
  maxConcurrency: string
  isRunning: boolean
  selectedModelLabel: string | null
  selectedJudgeLabel: string | null
  onModelChange: (model: ModelItem) => void
  onJudgeChange: (model: ModelItem) => void
  onJudgeThresholdChange: (value: string) => void
  onMaxConcurrencyChange: (value: string) => void
}

export function SingleModelBattleConfigPanel({
  modelKey,
  judgeKey,
  judgeThreshold,
  maxConcurrency,
  isRunning,
  selectedModelLabel,
  selectedJudgeLabel,
  onModelChange,
  onJudgeChange,
  onJudgeThresholdChange,
  onMaxConcurrencyChange,
}: SingleModelBattleConfigPanelProps) {
  return (
    <Card className="rounded-3xl border-border/70 shadow-sm">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg"><SlidersHorizontal className="h-5 w-5" />Step 1. 基础配置</CardTitle>
            <CardDescription>先锁定参赛模型与裁判模型，再设置阈值和并发。</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={selectedModelLabel ? 'default' : 'secondary'}>参赛模型{selectedModelLabel ? '已选' : '未选'}</Badge>
            <Badge variant={selectedJudgeLabel ? 'default' : 'secondary'}>裁判模型{selectedJudgeLabel ? '已选' : '未选'}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-2">
          <Label className="flex items-center gap-2"><Bot className="h-4 w-4" />参赛模型</Label>
          <ModelSelector
            selectedModelId={modelKey || null}
            onModelChange={onModelChange}
            size="lg"
            dropdownDirection="bottom"
            disabled={isRunning}
            className="w-full justify-between"
          />
        </div>
        <div className="space-y-2">
          <Label className="flex items-center gap-2"><Bot className="h-4 w-4" />裁判模型</Label>
          <ModelSelector
            selectedModelId={judgeKey || null}
            onModelChange={onJudgeChange}
            size="lg"
            dropdownDirection="bottom"
            disabled={isRunning}
            className="w-full justify-between"
          />
        </div>
        <div className="space-y-2">
          <Label className="flex items-center gap-2"><Gauge className="h-4 w-4" />裁判阈值 (0-1)</Label>
          <Input value={judgeThreshold} onChange={(e) => onJudgeThresholdChange(e.target.value)} disabled={isRunning} />
        </div>
        <div className="space-y-2">
          <Label className="flex items-center gap-2"><Gauge className="h-4 w-4" />并发上限 (1-6)</Label>
          <Input value={maxConcurrency} onChange={(e) => onMaxConcurrencyChange(e.target.value)} disabled={isRunning} />
        </div>
      </CardContent>
    </Card>
  )
}
