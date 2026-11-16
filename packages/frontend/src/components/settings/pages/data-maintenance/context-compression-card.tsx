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
 * 上下文压缩卡：contextCompressionEnabled 在主层，触发阈值和尾部保留条数收进「高级参数」。
 * 默认 0.5 / 12 适用于绝大多数模型，只有需要调整费用或上下文占用时才展开。
 */
export function ContextCompressionCard({ settings, update }: ContextCompressionCardProps) {
  const { toast } = useToast()
  const [enabled, setEnabled] = useState(true)
  const [thresholdDraft, setThresholdDraft] = useState("0.5")
  const [tailDraft, setTailDraft] = useState("12")
  const [saving, setSaving] = useState(false)

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

    setSaving(true)
    try {
      await update({
        contextCompressionEnabled: enabled,
        contextCompressionThresholdRatio: parsedCompressionRatio,
        contextCompressionTailMessages: parsedCompressionTail,
      })
      toast({ title: "压缩设置已保存" })
    } catch (error: any) {
      toast({
        title: "保存失败",
        description: error?.message || "压缩设置未保存，请重试",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <FeatureCard
      icon={Shrink}
      title="上下文压缩"
      description="对话过长时自动压缩为摘要，保留最近消息"
      cardKey="data-maintenance:compression"
      moreLabel="高级参数"
      more={
        <div className="space-y-3">
          <SettingRow
            title="压缩触发阈值（上下文比例）"
            description="按模型上下文窗口动态计算，默认 0.5（范围 0.2-0.9）；调到更高更省费用、更低更少丢上下文"
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
                disabled={!enabled || saving}
              />
              <span className="text-sm text-muted-foreground whitespace-nowrap">比例</span>
            </div>
          </SettingRow>

          <SettingRow
            title="压缩后保留最近消息数"
            description="压缩时强制保留末尾消息，避免影响当前轮上下文（默认 12，范围 4-50）"
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
                disabled={!enabled || saving}
              />
              <span className="text-sm text-muted-foreground whitespace-nowrap">条</span>
            </div>
          </SettingRow>
        </div>
      }
      footer={
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={!fieldChanged || saving}>
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
              <Badge className="bg-ink-tertiary/10 text-ink-tertiary">推荐</Badge>
            </div>
          )}
          description="达到阈值后把较早消息压缩为摘要，减少长会话的上下文占用与费用"
        >
          <Switch
            id="contextCompressionEnabled"
            checked={enabled}
            onCheckedChange={(checked) => setEnabled(Boolean(checked))}
          />
        </SettingRow>
      </div>
    </FeatureCard>
  )
}
