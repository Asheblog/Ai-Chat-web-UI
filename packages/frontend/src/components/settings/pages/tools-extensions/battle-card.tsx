"use client"

import { useCallback, useEffect, useState } from "react"
import { Swords } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"
import { FeatureCard } from "@/components/settings/components/feature-card"
import { SettingRow } from "@/components/settings/components/setting-row"
import type { SystemSettings } from "@/types"

export interface BattleCardProps {
  settings: SystemSettings
  update: (payload: Partial<SystemSettings>) => Promise<void>
}

/**
 * 模型大乱斗卡：4 个 battle* key（allowAnonymous/anonymousQuota/allowUsers/userQuota），
 * draft + 校验 + 还原模式适配自 SystemGeneralPage。
 */
export function BattleCard({ settings, update }: BattleCardProps) {
  const { toast } = useToast()
  const [battleAllowAnonymousDraft, setBattleAllowAnonymousDraft] = useState(true)
  const [battleAllowUsersDraft, setBattleAllowUsersDraft] = useState(true)
  const [battleAnonymousQuotaDraft, setBattleAnonymousQuotaDraft] = useState("20")
  const [battleUserQuotaDraft, setBattleUserQuotaDraft] = useState("200")

  const resetDrafts = useCallback(() => {
    setBattleAllowAnonymousDraft(Boolean(settings.battleAllowAnonymous ?? true))
    setBattleAllowUsersDraft(Boolean(settings.battleAllowUsers ?? true))
    setBattleAnonymousQuotaDraft(String(settings.battleAnonymousDailyQuota ?? 20))
    setBattleUserQuotaDraft(String(settings.battleUserDailyQuota ?? 200))
  }, [settings])

  useEffect(() => {
    resetDrafts()
  }, [resetDrafts])

  const normalizedInitials = {
    battleAllowAnonymous: Boolean(settings.battleAllowAnonymous ?? true),
    battleAllowUsers: Boolean(settings.battleAllowUsers ?? true),
    battleAnonymousQuota: String(settings.battleAnonymousDailyQuota ?? 20),
    battleUserQuota: String(settings.battleUserDailyQuota ?? 200),
  }

  const fieldChanged =
    battleAllowAnonymousDraft !== normalizedInitials.battleAllowAnonymous ||
    battleAllowUsersDraft !== normalizedInitials.battleAllowUsers ||
    battleAnonymousQuotaDraft !== normalizedInitials.battleAnonymousQuota ||
    battleUserQuotaDraft !== normalizedInitials.battleUserQuota

  const handleSave = async () => {
    const parsedBattleAnonymousQuota = Number.parseInt(battleAnonymousQuotaDraft, 10)
    if (Number.isNaN(parsedBattleAnonymousQuota) || parsedBattleAnonymousQuota < 0) {
      toast({ title: "输入无效", description: "匿名乱斗额度需为不小于 0 的整数", variant: "destructive" })
      return
    }
    const parsedBattleUserQuota = Number.parseInt(battleUserQuotaDraft, 10)
    if (Number.isNaN(parsedBattleUserQuota) || parsedBattleUserQuota < 0) {
      toast({ title: "输入无效", description: "注册用户乱斗额度需为不小于 0 的整数", variant: "destructive" })
      return
    }

    await update({
      battleAllowAnonymous: battleAllowAnonymousDraft,
      battleAllowUsers: battleAllowUsersDraft,
      battleAnonymousDailyQuota: parsedBattleAnonymousQuota,
      battleUserDailyQuota: parsedBattleUserQuota,
    })
    toast({ title: "乱斗设置已保存" })
  }

  return (
    <FeatureCard
      icon={Swords}
      title="模型大乱斗"
      description="控制乱斗功能的访问与每日次数"
      cardKey="tools-extensions:battle"
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={resetDrafts} disabled={!fieldChanged}>
            还原更改
          </Button>
          <Button onClick={handleSave} disabled={!fieldChanged}>
            保存乱斗设置
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <SettingRow
          title="允许匿名用户使用模型大乱斗"
          description="开启后匿名访客可参与模型乱斗"
        >
          <Switch
            id="battleAllowAnonymous"
            checked={battleAllowAnonymousDraft}
            onCheckedChange={(checked) => setBattleAllowAnonymousDraft(Boolean(checked))}
          />
        </SettingRow>

        <SettingRow
          title="匿名用户每日次数"
          description="匿名用户共享每日次数（0 表示当天不可使用）"
          align="start"
        >
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Input
              id="battleAnonymousDailyQuota"
              type="text"
              value={battleAnonymousQuotaDraft}
              onChange={(e) => setBattleAnonymousQuotaDraft(e.target.value)}
              className="w-full sm:w-28 text-right"
            />
            <span className="text-sm text-muted-foreground whitespace-nowrap">次/天</span>
          </div>
        </SettingRow>

        <SettingRow
          title="允许注册用户使用模型大乱斗"
          description="开启后注册用户可参与模型乱斗"
        >
          <Switch
            id="battleAllowUsers"
            checked={battleAllowUsersDraft}
            onCheckedChange={(checked) => setBattleAllowUsersDraft(Boolean(checked))}
          />
        </SettingRow>

        <SettingRow
          title="注册用户每日次数"
          description="每个注册用户的每日次数（0 表示当天不可使用）"
          align="start"
        >
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Input
              id="battleUserDailyQuota"
              type="text"
              value={battleUserQuotaDraft}
              onChange={(e) => setBattleUserQuotaDraft(e.target.value)}
              className="w-full sm:w-28 text-right"
            />
            <span className="text-sm text-muted-foreground whitespace-nowrap">次/天</span>
          </div>
        </SettingRow>
      </div>
    </FeatureCard>
  )
}
