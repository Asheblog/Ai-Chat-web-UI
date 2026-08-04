"use client"

import { useCallback, useEffect, useState } from "react"
import { UserPlus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { useToast } from "@/components/ui/use-toast"
import { syncAnonymousQuota } from "@/features/settings/api"
import { useAuthStore } from "@/store/auth-store"
import { FeatureCard } from "@/components/settings/components/feature-card"
import { SettingRow } from "@/components/settings/components/setting-row"
import type { SystemSettings } from "@/types"

export interface RegistrationPolicyCardProps {
  settings: SystemSettings
  update: (payload: Partial<SystemSettings>) => Promise<void>
  refresh: () => Promise<void>
}

/**
 * 注册策略卡：3 个 key（allowRegistration/anonymousDailyQuota/defaultUserDailyQuota），
 * draft/校验/fieldChanged/同步 AlertDialog 适配自 SystemGeneralPage 用户注册区块。
 * 同步按钮独立于保存，确认即调 syncAnonymousQuota({ resetUsed: true })。
 */
export function RegistrationPolicyCard({ settings, update, refresh }: RegistrationPolicyCardProps) {
  const { toast } = useToast()
  const { actorState, user } = useAuthStore((state) => ({
    actorState: state.actorState,
    user: state.user,
  }))
  const isAdmin = actorState === 'authenticated' && user?.role === 'ADMIN'
  const [allowRegistrationDraft, setAllowRegistrationDraft] = useState(true)
  const [anonymousQuotaDraft, setAnonymousQuotaDraft] = useState('20')
  const [defaultUserQuotaDraft, setDefaultUserQuotaDraft] = useState('200')
  const [syncingAnonymousQuota, setSyncingAnonymousQuota] = useState(false)
  const [syncDialogOpen, setSyncDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const resetDrafts = useCallback(() => {
    setAllowRegistrationDraft(Boolean(settings.allowRegistration))
    setAnonymousQuotaDraft(String(settings.anonymousDailyQuota ?? 20))
    setDefaultUserQuotaDraft(String(settings.defaultUserDailyQuota ?? 200))
  }, [settings])

  useEffect(() => {
    resetDrafts()
  }, [resetDrafts])

  const normalizedInitials = {
    allowRegistration: Boolean(settings.allowRegistration),
    anonymousQuota: String(settings.anonymousDailyQuota ?? 20),
    defaultUserQuota: String(settings.defaultUserDailyQuota ?? 200),
  }

  const fieldChanged =
    allowRegistrationDraft !== normalizedInitials.allowRegistration ||
    anonymousQuotaDraft !== normalizedInitials.anonymousQuota ||
    defaultUserQuotaDraft !== normalizedInitials.defaultUserQuota

  const handleSyncAnonymousQuota = async () => {
    if (!isAdmin || syncingAnonymousQuota) return
    setSyncingAnonymousQuota(true)
    try {
      await syncAnonymousQuota({ resetUsed: true })
      await refresh()
      toast({ title: '已同步匿名额度', description: '匿名访客额度已更新为当前默认值，并清零今日用量。' })
    } catch (err: any) {
      toast({ title: '同步失败', description: err?.response?.data?.error || err?.message || '操作失败', variant: 'destructive' })
    } finally {
      setSyncingAnonymousQuota(false)
      setSyncDialogOpen(false)
    }
  }

  const handleSave = async () => {
    if (!isAdmin || saving) return
    const parsedAnonymousQuota = Number.parseInt(anonymousQuotaDraft, 10)
    if (Number.isNaN(parsedAnonymousQuota) || parsedAnonymousQuota < 0) {
      toast({ title: '输入无效', description: '匿名访客额度需为不小于 0 的整数', variant: 'destructive' })
      return
    }
    const parsedDefaultQuota = Number.parseInt(defaultUserQuotaDraft, 10)
    if (Number.isNaN(parsedDefaultQuota) || parsedDefaultQuota < 0) {
      toast({ title: '输入无效', description: '注册用户额度需为不小于 0 的整数', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      await update({
        allowRegistration: allowRegistrationDraft,
        anonymousDailyQuota: parsedAnonymousQuota,
        defaultUserDailyQuota: parsedDefaultQuota,
      })
      toast({ title: '已保存注册策略' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <FeatureCard
      icon={UserPlus}
      title="用户注册"
      description="控制新用户的注册和访客访问"
      cardKey="users-registration:policy"
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button onClick={handleSave} disabled={!fieldChanged || !isAdmin || saving}>
            {saving ? '保存中...' : '保存注册策略'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <SettingRow
          title={(
            <div className="flex items-center gap-2">
              开放用户注册
              <Badge variant="secondary">推荐</Badge>
            </div>
          )}
          description="允许新用户自行注册账号，关闭后只能由管理员手动创建用户"
        >
          <Switch
            id="allowRegistration"
            checked={allowRegistrationDraft}
            disabled={!isAdmin}
            onCheckedChange={(checked) => setAllowRegistrationDraft(Boolean(checked))}
          />
        </SettingRow>

        <SettingRow
          title="匿名访客每日额度"
          description="未登录用户每天可使用的对话次数（设置为 0 表示禁用匿名访问）"
          align="start"
        >
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Input
              id="anonymousDailyQuota"
              type="text"
              value={anonymousQuotaDraft}
              onChange={(e) => setAnonymousQuotaDraft(e.target.value)}
              className="w-full sm:w-28 text-right"
              disabled={!isAdmin}
            />
            <span className="text-sm text-muted-foreground whitespace-nowrap">次/天</span>
            <AlertDialog open={syncDialogOpen} onOpenChange={setSyncDialogOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!isAdmin || syncingAnonymousQuota}
                >{syncingAnonymousQuota ? '同步中...' : '同步'}</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认同步匿名访客额度？</AlertDialogTitle>
                  <AlertDialogDescription>
                    该操作会重置匿名访客今日已用额度，并将额度同步为当前默认值。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={syncingAnonymousQuota}>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={handleSyncAnonymousQuota} disabled={syncingAnonymousQuota}>
                    {syncingAnonymousQuota ? '处理中…' : '确认同步'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </SettingRow>

        <SettingRow
          title="注册用户默认每日额度"
          description="新注册用户的初始每日对话额度，可在用户管理中单独调整"
          align="start"
        >
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Input
              id="defaultUserDailyQuota"
              type="text"
              value={defaultUserQuotaDraft}
              onChange={(e) => setDefaultUserQuotaDraft(e.target.value)}
              className="w-full sm:w-28 text-right"
              disabled={!isAdmin}
            />
            <span className="text-sm text-muted-foreground whitespace-nowrap">次/天</span>
          </div>
        </SettingRow>
      </div>
    </FeatureCard>
  )
}
