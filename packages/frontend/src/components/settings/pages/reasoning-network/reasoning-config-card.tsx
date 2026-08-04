"use client"

import { Brain } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { FeatureCard } from "@/components/settings/components/feature-card"
import { SettingRow } from "@/components/settings/components/setting-row"

export type ReasoningTagsMode = 'default' | 'custom' | 'off'

export interface ReasoningConfigCardProps {
  reasoningEnabled: boolean
  onReasoningEnabledChange: (v: boolean) => void
  reasoningSaveToDb: boolean
  onReasoningSaveToDbChange: (v: boolean) => void
  reasoningMaxTokens: string
  onReasoningMaxTokensChange: (v: string) => void
  temperatureDefault: string
  onTemperatureDefaultChange: (v: string) => void
  reasoningTagsMode: ReasoningTagsMode
  onReasoningTagsModeChange: (v: ReasoningTagsMode) => void
  reasoningCustomTags: string
  onReasoningCustomTagsChange: (v: string) => void
}

/**
 * 推理链配置卡：常用项平铺（源 SystemReasoning 前 6 行）。
 */
export function ReasoningConfigCard({
  reasoningEnabled,
  onReasoningEnabledChange,
  reasoningSaveToDb,
  onReasoningSaveToDbChange,
  reasoningMaxTokens,
  onReasoningMaxTokensChange,
  temperatureDefault,
  onTemperatureDefaultChange,
  reasoningTagsMode,
  onReasoningTagsModeChange,
  reasoningCustomTags,
  onReasoningCustomTagsChange,
}: ReasoningConfigCardProps) {
  return (
    <FeatureCard
      icon={Brain}
      title="推理链配置"
      description="控制模型思考过程与默认生成参数"
      cardKey="reasoning-network:reasoning"
    >
      <SettingRow
        title="启用推理链"
        description="识别 reasoning_content 与常见 CoT 标签，并在 UI 折叠显示"
      >
        <Switch id="reasoningEnabled" checked={reasoningEnabled} onCheckedChange={(v) => onReasoningEnabledChange(!!v)} />
      </SettingRow>

      <SettingRow
        title="保存到数据库"
        description="可能包含中间推断过程，请按需开启"
      >
        <Switch id="reasoningSaveToDb" checked={reasoningSaveToDb} onCheckedChange={(v) => onReasoningSaveToDbChange(!!v)} />
      </SettingRow>

      <SettingRow
        title="默认生成 Tokens"
        description="为空表示沿用供应商默认（通常 32K），可根据模型能力设置 1~256000"
      >
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
          <Input
            type="text"
            placeholder="32000"
            value={reasoningMaxTokens}
            onChange={(e) => onReasoningMaxTokensChange(e.target.value)}
            className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 w-full sm:w-32 text-right"
          />
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            onClick={() => onReasoningMaxTokensChange('')}
          >
            恢复默认
          </Button>
        </div>
      </SettingRow>

      <SettingRow
        title="默认温度"
        description="为空表示使用系统默认值（0.7），范围 0~2"
      >
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
          <Input
            type="text"
            placeholder="0.7"
            value={temperatureDefault}
            onChange={(e) => onTemperatureDefaultChange(e.target.value)}
            className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 w-full sm:w-32 text-right"
          />
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            onClick={() => onTemperatureDefaultChange('')}
          >
            恢复默认
          </Button>
        </div>
      </SettingRow>

      <SettingRow
        title="标签模式"
        description="默认包含 <think> / <|begin_of_thought|> 等常见标签"
        align="start"
      >
        <div className="flex w-full flex-wrap items-center justify-end gap-3">
          <Select value={reasoningTagsMode} onValueChange={(v) => onReasoningTagsModeChange(v as ReasoningTagsMode)}>
            <SelectTrigger className="w-full sm:w-[220px]"><SelectValue placeholder="选择模式" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="default">默认</SelectItem>
              <SelectItem value="custom">自定义</SelectItem>
              <SelectItem value="off">关闭</SelectItem>
            </SelectContent>
          </Select>
          {reasoningTagsMode === 'custom' && (
            <Input
              placeholder='["<think>","</think>"]'
              value={reasoningCustomTags}
              onChange={(e) => onReasoningCustomTagsChange(e.target.value)}
              className="w-full sm:w-[320px] font-mono text-xs"
            />
          )}
        </div>
      </SettingRow>
    </FeatureCard>
  )
}
