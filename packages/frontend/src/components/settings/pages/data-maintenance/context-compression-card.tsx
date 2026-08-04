"use client"

import { useCallback, useEffect, useState } from "react"
import { Shrink } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"
import { FeatureCard } from "@/components/settings/components/feature-card"
import { SettingRow } from "@/components/settings/components/setting-row"
import type { SystemSettings } from "@/types"

export interface ContextCompressionCardProps {
  settings: SystemSettings
  update: (payload: Partial<SystemSettings>) => Promise<void>
}

/**
 * 上下文压缩卡：3 个 key（contextCompressionEnabled/ThresholdRatio/TailMessages），
 * draft + 校验模式适配自 SystemGeneralPage；关闭启用开关时后两行 disabled。
 */
export function ContextCompressionCard({ settings, update }: ContextCompressionCardProps) {
  const { toast } = useToast()
  const [enabled, setEnabled] = useState(true)
  const [thresholdDraft, setThresholdDraft] = useState("0.5")
  const [tailDraft, setTailDraft] = useState("12")

  const resetDrafts = useCallback(() => {
    setEnabled(Boolean(settings.contextCompressionEnabled ?? true))
    setThresholdDraft(String(settings.contextCompressionThresholdRatio ?? 0.5))
    setTailDraft(String(settings.contextCompressionTailMessages ?? 12))
  }, [settings])

  useEffect(() => {
    resetDrafts()
  }, [resetDrafts])

  const normalizedInitials = {
    enabled: Boolean(settings.contextCompressionEnabled ?? true),
    thresholdRatio: String(settings.contextCompressionThresholdRatio ?? 0.5),
    tailMessages: String(settings.contextCompressionTailMessages ?? 12),
  }

  const fieldChanged =
    enabled !== normalizedInitials.enabled ||
    thresholdDraft !== normalizedInitials.thresholdRatio ||
    tailDraft !== normalizedInitials.tailMessages

  const handleSave = async () => {
    const parsedCompressionRatio = Number.parseFloat(thresholdDraft)
    if (!Number.isFinite(parsedCompressionRatio) || parsedCompressionRatio < 0.2 || parsedCompressionRatio > 0.9) {
      toast({ title: "输入无效", description: "上下文压缩阈值需在 0.2 到 0.9 之间", variant: "destructive" })
      return
    }
    const parsedCompressionTail = Number.parseInt(tailDraft, 10)
    if (!Number.isFinite(parsedCompressionTail) || parsedCompressionTail < 4 || parsedCompressionTail > 50) {
      toast({ title: "输入无效", description: "上下文压缩尾部消息数需在 4 到 50 之间", variant: "destructive" })
      return
    }

    await update({
      contextCompressionEnabled: enabled,
      contextCompressionThresholdRatio: parsedCompressionRatio,
      contextCompressionTailMessages: parsedCompressionTail,
    })
    toast({ title: "压缩设置已保存" })
  }

  return (
    <FeatureCard
      icon={Shrink}
      title="上下文压缩"
      description="对话过长时自动压缩，保留最近消息"
      cardKey="data-maintenance:compression"
      footer={
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={!fieldChanged}>
            保存压缩设置
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <SettingRow
          title={(
            <div className="flex items-center gap-2">
              启用压缩
              <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">推荐</Badge>
            </div>
          )}
          description="达到阈值后自动将较早消息压缩为摘要，减少长会话上下文占用"
        >
          <Switch
            id="contextCompressionEnabled"
            checked={enabled}
            onCheckedChange={(checked) => setEnabled(Boolean(checked))}
          />
        </SettingRow>

        <SettingRow
          title="压缩触发阈值（上下文比例）"
          description="按模型上下文窗口动态计算阈值，默认 0.5（范围 0.2-0.9）"
          align="start"
        >
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Input
              id="contextCompressionThresholdRatio"
              type="text"
              inputMode="decimal"
              value={thresholdDraft}
              onChange={(e) => setThresholdDraft(e.target.value)}
              className="w-full sm:w-28 text-right"
              disabled={!enabled}
            />
            <span className="text-sm text-muted-foreground whitespace-nowrap">比例</span>
          </div>
        </SettingRow>

        <SettingRow
          title="压缩后保留最近消息数"
          description="压缩时强制保留末尾消息，避免影响当前轮上下文（范围 4-50）"
          align="start"
        >
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Input
              id="contextCompressionTailMessages"
              type="text"
              inputMode="numeric"
              value={tailDraft}
              onChange={(e) => setTailDraft(e.target.value)}
              className="w-full sm:w-28 text-right"
              disabled={!enabled}
            />
            <span className="text-sm text-muted-foreground whitespace-nowrap">条</span>
          </div>
        </SettingRow>
      </div>
    </FeatureCard>
  )
}
