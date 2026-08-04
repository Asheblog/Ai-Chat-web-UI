"use client"

import { useCallback, useEffect, useState } from "react"
import { Type } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"
import { FeatureCard } from "@/components/settings/components/feature-card"
import { SettingRow } from "@/components/settings/components/setting-row"
import type { SystemSettings } from "@/types"

export interface TitleSummaryCardProps {
  settings: SystemSettings
  update: (payload: Partial<SystemSettings>) => Promise<void>
}

/**
 * 标题智能总结卡：3 个 titleSummary* key（enabled/maxLength/modelSource），
 * draft + 还原模式适配自 SystemGeneralPage。
 */
export function TitleSummaryCard({ settings, update }: TitleSummaryCardProps) {
  const { toast } = useToast()
  const [titleSummaryEnabledDraft, setTitleSummaryEnabledDraft] = useState(false)
  const [titleSummaryMaxLengthDraft, setTitleSummaryMaxLengthDraft] = useState(20)
  const [titleSummaryModelSourceDraft, setTitleSummaryModelSourceDraft] =
    useState<'current' | 'specified'>('current')

  const resetDrafts = useCallback(() => {
    setTitleSummaryEnabledDraft(Boolean(settings.titleSummaryEnabled))
    setTitleSummaryMaxLengthDraft(settings.titleSummaryMaxLength ?? 20)
    setTitleSummaryModelSourceDraft(settings.titleSummaryModelSource ?? 'current')
  }, [settings])

  useEffect(() => {
    resetDrafts()
  }, [resetDrafts])

  const normalizedInitials = {
    titleSummaryEnabled: Boolean(settings.titleSummaryEnabled),
    titleSummaryMaxLength: settings.titleSummaryMaxLength ?? 20,
    titleSummaryModelSource: settings.titleSummaryModelSource ?? 'current',
  }

  const fieldChanged =
    titleSummaryEnabledDraft !== normalizedInitials.titleSummaryEnabled ||
    titleSummaryMaxLengthDraft !== normalizedInitials.titleSummaryMaxLength ||
    titleSummaryModelSourceDraft !== normalizedInitials.titleSummaryModelSource

  const handleSave = async () => {
    await update({
      titleSummaryEnabled: titleSummaryEnabledDraft,
      titleSummaryMaxLength: titleSummaryMaxLengthDraft,
      titleSummaryModelSource: titleSummaryModelSourceDraft,
    })
    toast({ title: "标题总结设置已保存" })
  }

  return (
    <FeatureCard
      icon={Type}
      title="标题智能总结"
      description="使用 AI 自动为对话生成简洁标题"
      cardKey="tools-extensions:title-summary"
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={resetDrafts} disabled={!fieldChanged}>
            还原更改
          </Button>
          <Button onClick={handleSave} disabled={!fieldChanged}>
            保存标题总结设置
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <SettingRow
          title={(
            <div className="flex items-center gap-2">
              启用智能标题
              <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">实验性</Badge>
            </div>
          )}
          description="发送首条消息时自动调用模型生成对话标题"
        >
          <Switch
            id="titleSummaryEnabled"
            checked={titleSummaryEnabledDraft}
            onCheckedChange={(checked) => setTitleSummaryEnabledDraft(Boolean(checked))}
          />
        </SettingRow>

        <SettingRow
          title="标题最大长度"
          description="生成的标题字数限制（5-50字）"
          align="start"
        >
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Input
              id="titleSummaryMaxLength"
              type="text"
              inputMode="numeric"
              value={titleSummaryMaxLengthDraft}
              onChange={(e) => {
                const val = Number.parseInt(e.target.value, 10)
                if (!Number.isNaN(val)) {
                  setTitleSummaryMaxLengthDraft(Math.max(5, Math.min(50, val)))
                }
              }}
              className="w-full sm:w-28 text-right"
              disabled={!titleSummaryEnabledDraft}
            />
            <span className="text-sm text-muted-foreground whitespace-nowrap">字</span>
          </div>
        </SettingRow>

        <SettingRow
          title="模型选择"
          description="选择用于生成标题的模型来源"
          align="start"
        >
          <Select
            value={titleSummaryModelSourceDraft}
            onValueChange={(value: 'current' | 'specified') => setTitleSummaryModelSourceDraft(value)}
            disabled={!titleSummaryEnabledDraft}
          >
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder="选择模型来源" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="current">使用当前会话模型</SelectItem>
              <SelectItem value="specified">指定模型（暂不支持）</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
      </div>
    </FeatureCard>
  )
}
