"use client"

import { useCallback, useEffect, useState } from "react"
import { Clock } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/use-toast"
import { FeatureCard } from "@/components/settings/components/feature-card"
import { SettingRow } from "@/components/settings/components/setting-row"
import type { SystemSettings } from "@/types"

export interface RetentionPolicyCardProps {
  settings: SystemSettings
  update: (payload: Partial<SystemSettings>) => Promise<void>
}

/**
 * 数据保留策略卡：4 个 key（chatImageRetentionDays/battleRetentionDays/
 * assistantReplyHistoryLimit/anonymousRetentionDays），draft + 校验模式适配自 SystemGeneralPage。
 */
export function RetentionPolicyCard({ settings, update }: RetentionPolicyCardProps) {
  const { toast } = useToast()
  const [retentionDraft, setRetentionDraft] = useState("30")
  const [battleRetentionDraft, setBattleRetentionDraft] = useState("15")
  const [replyHistoryLimitDraft, setReplyHistoryLimitDraft] = useState("5")
  const [anonymousRetentionDraft, setAnonymousRetentionDraft] = useState("15")

  const resetDrafts = useCallback(() => {
    setRetentionDraft(String(settings.chatImageRetentionDays ?? 30))
    setBattleRetentionDraft(String(settings.battleRetentionDays ?? 15))
    setReplyHistoryLimitDraft(String(settings.assistantReplyHistoryLimit ?? 5))
    setAnonymousRetentionDraft(String(settings.anonymousRetentionDays ?? 15))
  }, [settings])

  useEffect(() => {
    resetDrafts()
  }, [resetDrafts])

  const normalizedInitials = {
    chatImageRetentionDays: String(settings.chatImageRetentionDays ?? 30),
    battleRetentionDays: String(settings.battleRetentionDays ?? 15),
    assistantReplyHistoryLimit: String(settings.assistantReplyHistoryLimit ?? 5),
    anonymousRetentionDays: String(settings.anonymousRetentionDays ?? 15),
  }

  const fieldChanged =
    retentionDraft !== normalizedInitials.chatImageRetentionDays ||
    battleRetentionDraft !== normalizedInitials.battleRetentionDays ||
    replyHistoryLimitDraft !== normalizedInitials.assistantReplyHistoryLimit ||
    anonymousRetentionDraft !== normalizedInitials.anonymousRetentionDays

  const handleSave = async () => {
    const parsedRetention = Number.parseInt(retentionDraft, 10)
    if (Number.isNaN(parsedRetention) || parsedRetention < 0) {
      toast({ title: "输入无效", description: "图片保留天数需为不小于 0 的整数", variant: "destructive" })
      return
    }
    const parsedBattleRetentionDays = Number.parseInt(battleRetentionDraft, 10)
    if (Number.isNaN(parsedBattleRetentionDays) || parsedBattleRetentionDays < 0 || parsedBattleRetentionDays > 3650) {
      toast({ title: "输入无效", description: "乱斗历史保留天数需在 0 到 3650 之间", variant: "destructive" })
      return
    }
    const parsedReplyHistoryLimit = Number.parseInt(replyHistoryLimitDraft, 10)
    if (Number.isNaN(parsedReplyHistoryLimit) || parsedReplyHistoryLimit < 1 || parsedReplyHistoryLimit > 20) {
      toast({ title: "输入无效", description: "AI 回答历史上限需在 1 到 20 之间", variant: "destructive" })
      return
    }
    const parsedAnonymousRetention = Number.parseInt(anonymousRetentionDraft, 10)
    if (Number.isNaN(parsedAnonymousRetention) || parsedAnonymousRetention < 0 || parsedAnonymousRetention > 15) {
      toast({ title: "输入无效", description: "匿名访客数据保留天数需在 0 到 15 之间", variant: "destructive" })
      return
    }

    await update({
      chatImageRetentionDays: parsedRetention,
      battleRetentionDays: parsedBattleRetentionDays,
      assistantReplyHistoryLimit: parsedReplyHistoryLimit,
      anonymousRetentionDays: parsedAnonymousRetention,
    })
    toast({ title: "保留策略已保存" })
  }

  return (
    <FeatureCard
      icon={Clock}
      title="数据保留策略"
      description="控制系统数据的自动清理规则"
      footer={
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={!fieldChanged}>
            保存保留策略
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <SettingRow
          title={(
            <div className="flex items-center gap-2">
              聊天图片保留天数
              <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">存储优化</Badge>
            </div>
          )}
          description="超过此天数的聊天图片将被自动清理（0 表示永久保留，范围 0-3650 天）"
          align="start"
        >
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Input
              id="chatImageRetentionDays"
              type="text"
              inputMode="numeric"
              value={retentionDraft}
              onChange={(e) => setRetentionDraft(e.target.value)}
              className="w-full sm:w-28 text-right"
            />
            <span className="text-sm text-muted-foreground whitespace-nowrap">天</span>
          </div>
        </SettingRow>

        <SettingRow
          title="乱斗历史保留天数（battle/share）"
          description="按创建时间自动清理已结束的乱斗与分享记录（0 表示关闭自动清理，范围 0-3650 天）"
          align="start"
        >
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Input
              id="battleRetentionDays"
              type="text"
              inputMode="numeric"
              value={battleRetentionDraft}
              onChange={(e) => setBattleRetentionDraft(e.target.value)}
              className="w-full sm:w-28 text-right"
            />
            <span className="text-sm text-muted-foreground whitespace-nowrap">天</span>
          </div>
        </SettingRow>

        <SettingRow
          title="单条消息 AI 回答上限"
          description="同一条用户消息最多保留的 AI 回答数量（范围 1-20），超过后自动删除最旧的回答"
          align="start"
        >
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Input
              id="assistantReplyHistoryLimit"
              type="text"
              inputMode="numeric"
              value={replyHistoryLimitDraft}
              onChange={(e) => setReplyHistoryLimitDraft(e.target.value)}
              className="w-full sm:w-28 text-right"
            />
            <span className="text-sm text-muted-foreground whitespace-nowrap">条</span>
          </div>
        </SettingRow>

        <SettingRow
          title="匿名访客数据保留天数"
          description="匿名用户的聊天记录保留时长（0 表示永久保留，范围 0-15 天）"
          align="start"
        >
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Input
              id="anonymousRetentionDays"
              type="text"
              value={anonymousRetentionDraft}
              onChange={(e) => setAnonymousRetentionDraft(e.target.value)}
              className="w-full sm:w-28 text-right"
            />
            <span className="text-sm text-muted-foreground whitespace-nowrap">天</span>
          </div>
        </SettingRow>
      </div>
    </FeatureCard>
  )
}
