"use client"

import { Brain } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { FeatureCard } from "@/components/settings/components/feature-card"
import { SettingRow } from "@/components/settings/components/setting-row"

export type ReasoningTagsMode = 'default' | 'custom' | 'off'
export type ReasoningEffort = 'unset' | 'low' | 'medium' | 'high' | 'max' | 'xhigh'

export interface ReasoningConfigCardProps {
  reasoningEnabled: boolean
  onReasoningEnabledChange: (v: boolean) => void
  reasoningSaveToDb: boolean
  onReasoningSaveToDbChange: (v: boolean) => void
  openaiReasoningEffort: ReasoningEffort
  onOpenaiReasoningEffortChange: (v: ReasoningEffort) => void
  reasoningTagsMode: ReasoningTagsMode
  onReasoningTagsModeChange: (v: ReasoningTagsMode) => void
  reasoningCustomTags: string
  onReasoningCustomTagsChange: (v: string) => void
  reasoningMaxTokens: string
  onReasoningMaxTokensChange: (v: string) => void
  temperatureDefault: string
  onTemperatureDefaultChange: (v: string) => void
}

/**
 * 推理与生成卡：主层只留「识别」与「保存」两件事——它们是两个独立要求，
 * 识别决定是否解析并折叠展示思考过程，保存决定是否把推理文本落库。
 * 推理强度兜底、标签兼容、温度与生成上限都是按模型/按协议的兼容参数，收进高级。
 */
export function ReasoningConfigCard({
  reasoningEnabled,
  onReasoningEnabledChange,
  reasoningSaveToDb,
  onReasoningSaveToDbChange,
  openaiReasoningEffort,
  onOpenaiReasoningEffortChange,
  reasoningTagsMode,
  onReasoningTagsModeChange,
  reasoningCustomTags,
  onReasoningCustomTagsChange,
  reasoningMaxTokens,
  onReasoningMaxTokensChange,
  temperatureDefault,
  onTemperatureDefaultChange,
}: ReasoningConfigCardProps) {
  return (
    <FeatureCard
      icon={Brain}
      title="推理与生成"
      description="识别并展示模型的思考过程；默认生成参数按模型解析"
      cardKey="reasoning-network:reasoning"
      moreLabel="更多参数"
      more={
        <>
          <SettingRow
            title="推理强度兜底"
            htmlFor="openaiReasoningEffort"
            description="默认不显式发送；模型级设置优先，这里只是不支持按模型配置时的全局兜底"
          >
            {(descriptionId) => (
              <Select
                value={openaiReasoningEffort}
                onValueChange={(v) => onOpenaiReasoningEffortChange(v as ReasoningEffort)}
              >
                <SelectTrigger id="openaiReasoningEffort" aria-describedby={descriptionId} className="w-full sm:w-[220px]">
                  <SelectValue placeholder="不设置" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">不设置</SelectItem>
                  <SelectItem value="low">low</SelectItem>
                  <SelectItem value="medium">medium</SelectItem>
                  <SelectItem value="high">high</SelectItem>
                  <SelectItem value="xhigh">xhigh</SelectItem>
                  <SelectItem value="max">max</SelectItem>
                </SelectContent>
              </Select>
            )}
          </SettingRow>

          <SettingRow
            title="标签兼容"
            htmlFor="reasoningTagsMode"
            description="仅在模型以文本标签输出思考过程时需要；官方结构化字段不受影响"
            align="start"
          >
            {(descriptionId) => (
              <div className="flex w-full flex-wrap items-center justify-end gap-3">
                <Select value={reasoningTagsMode} onValueChange={(v) => onReasoningTagsModeChange(v as ReasoningTagsMode)}>
                  <SelectTrigger id="reasoningTagsMode" aria-describedby={descriptionId} className="w-full sm:w-[220px]">
                    <SelectValue placeholder="选择模式" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">默认标签</SelectItem>
                    <SelectItem value="custom">自定义标签</SelectItem>
                    <SelectItem value="off">不解析标签</SelectItem>
                  </SelectContent>
                </Select>
                {reasoningTagsMode === 'custom' ? (
                  <Input
                    aria-describedby={descriptionId}
                    aria-label="自定义标签 JSON 数组"
                    placeholder='[" thinking","</think>"]'
                    value={reasoningCustomTags}
                    onChange={(e) => onReasoningCustomTagsChange(e.target.value)}
                    className="w-full sm:w-[320px] font-mono text-xs"
                  />
                ) : null}
              </div>
            )}
          </SettingRow>

          <SettingRow
            title="默认温度"
            htmlFor="temperatureDefault"
            description="为空表示使用系统默认值（0.7）；部分思考模式会忽略它"
          >
            {(descriptionId) => (
              <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
                <Input
                  id="temperatureDefault"
                  aria-describedby={descriptionId}
                  type="text"
                  placeholder="0.7"
                  value={temperatureDefault}
                  onChange={(e) => onTemperatureDefaultChange(e.target.value)}
                  className="num-tabular w-full text-right sm:w-32"
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
            )}
          </SettingRow>

          <SettingRow
            title="默认生成上限"
            htmlFor="reasoningMaxTokens"
            description="留空表示自动：按模型与协议解析，显式填写才固定上限（范围 1~256000）"
          >
            {(descriptionId) => (
              <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
                <Input
                  id="reasoningMaxTokens"
                  aria-describedby={descriptionId}
                  type="text"
                  placeholder="自动"
                  value={reasoningMaxTokens}
                  onChange={(e) => onReasoningMaxTokensChange(e.target.value)}
                  className="num-tabular w-full text-right sm:w-32"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={() => onReasoningMaxTokensChange('')}
                >
                  自动
                </Button>
              </div>
            )}
          </SettingRow>
        </>
      }
    >
      <SettingRow
        title="启用推理识别"
        htmlFor="reasoningEnabled"
        description="识别 reasoning_content 与常见 CoT 标签，在对话里折叠展示"
      >
        {(descriptionId) => (
          <Switch
            aria-describedby={descriptionId}
            id="reasoningEnabled"
            checked={reasoningEnabled}
            onCheckedChange={(v) => onReasoningEnabledChange(!!v)}
          />
        )}
      </SettingRow>

      <SettingRow
        title="保存推理文本"
        htmlFor="reasoningSaveToDb"
        description="思考过程可能包含中间推断，按需开启；关闭只影响留存，不影响当次展示"
      >
        {(descriptionId) => (
          <Switch
            aria-describedby={descriptionId}
            id="reasoningSaveToDb"
            checked={reasoningSaveToDb}
            onCheckedChange={(v) => onReasoningSaveToDbChange(!!v)}
          />
        )}
      </SettingRow>
    </FeatureCard>
  )
}
