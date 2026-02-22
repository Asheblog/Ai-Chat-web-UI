"use client"
import { useCallback, useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CardTitle, CardDescription } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
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
import { useSystemSettings } from "@/hooks/use-system-settings"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/components/ui/use-toast"
import { refreshImageAttachments, syncAnonymousQuota } from '@/features/settings/api'
import { useAuthStore } from "@/store/auth-store"
import { UserPlus, Palette, Clock, Type, Swords } from "lucide-react"
import { SettingRow } from "@/components/settings/components/setting-row"
import { AvatarUploadField, type AvatarUploadResult } from "@/components/settings/components/avatar-upload-field"

/**
 * 系统通用设置页面：抽离到 features 层，供系统页和弹窗共用。
 */

export function SystemGeneralPage() {
  const {
    settings: systemSettings,
    refresh: fetchSystemSettings,
    update: updateSystemSettings,
    isLoading,
    error,
  } = useSystemSettings()
  const { toast } = useToast()
  const { actorState, user } = useAuthStore((state) => ({
    actorState: state.actorState,
    user: state.user,
  }))
  const isAdmin = actorState === 'authenticated' && user?.role === 'ADMIN'
  const [allowRegistrationDraft, setAllowRegistrationDraft] = useState(true)
  const [brandTextDraft, setBrandTextDraft] = useState("")
  const [, setIsIMEComposing] = useState(false)
  const [chatSystemPromptDraft, setChatSystemPromptDraft] = useState('')
  const [retentionDraft, setRetentionDraft] = useState('30')
  const [replyHistoryLimitDraft, setReplyHistoryLimitDraft] = useState('5')
  const [siteBaseDraft, setSiteBaseDraft] = useState('')
  const [anonymousQuotaDraft, setAnonymousQuotaDraft] = useState('20')
  const [defaultUserQuotaDraft, setDefaultUserQuotaDraft] = useState('200')
  const [anonymousRetentionDraft, setAnonymousRetentionDraft] = useState('15')
  const [battleAllowAnonymousDraft, setBattleAllowAnonymousDraft] = useState(true)
  const [battleAllowUsersDraft, setBattleAllowUsersDraft] = useState(true)
  const [battleAnonymousQuotaDraft, setBattleAnonymousQuotaDraft] = useState('20')
  const [battleUserQuotaDraft, setBattleUserQuotaDraft] = useState('200')
  const [battleRetentionDraft, setBattleRetentionDraft] = useState('15')
  const [syncingAnonymousQuota, setSyncingAnonymousQuota] = useState(false)
  const [syncDialogOpen, setSyncDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [assistantAvatarPreview, setAssistantAvatarPreview] = useState<string | null>(null)
  const [assistantAvatarSaving, setAssistantAvatarSaving] = useState(false)
  // 标题智能总结设置
  const [titleSummaryEnabledDraft, setTitleSummaryEnabledDraft] = useState(false)
  const [titleSummaryMaxLengthDraft, setTitleSummaryMaxLengthDraft] = useState(20)
  const [titleSummaryModelSourceDraft, setTitleSummaryModelSourceDraft] = useState<'current' | 'specified'>('current')

  useEffect(() => { fetchSystemSettings() }, [fetchSystemSettings])
  const resetDrafts = useCallback(() => {
    if (!systemSettings) return
    setAllowRegistrationDraft(Boolean(systemSettings.allowRegistration))
    setBrandTextDraft(systemSettings.brandText || '')
    setChatSystemPromptDraft(systemSettings.chatSystemPrompt || '')
    setRetentionDraft(String(systemSettings.chatImageRetentionDays ?? 30))
    setReplyHistoryLimitDraft(String(systemSettings.assistantReplyHistoryLimit ?? 5))
    setSiteBaseDraft(systemSettings.siteBaseUrl || '')
    setAnonymousQuotaDraft(String(systemSettings.anonymousDailyQuota ?? 20))
    setDefaultUserQuotaDraft(String(systemSettings.defaultUserDailyQuota ?? 200))
    setAnonymousRetentionDraft(String(systemSettings.anonymousRetentionDays ?? 15))
    setBattleAllowAnonymousDraft(Boolean(systemSettings.battleAllowAnonymous ?? true))
    setBattleAllowUsersDraft(Boolean(systemSettings.battleAllowUsers ?? true))
    setBattleAnonymousQuotaDraft(String(systemSettings.battleAnonymousDailyQuota ?? 20))
    setBattleUserQuotaDraft(String(systemSettings.battleUserDailyQuota ?? 200))
    setBattleRetentionDraft(String(systemSettings.battleRetentionDays ?? 15))
    setAssistantAvatarPreview(systemSettings.assistantAvatarUrl || null)
    // 标题总结
    setTitleSummaryEnabledDraft(Boolean(systemSettings.titleSummaryEnabled))
    setTitleSummaryMaxLengthDraft(systemSettings.titleSummaryMaxLength ?? 20)
    setTitleSummaryModelSourceDraft(systemSettings.titleSummaryModelSource ?? 'current')
  }, [systemSettings])

  useEffect(() => {
    resetDrafts()
  }, [resetDrafts])

  if (isLoading && !systemSettings) {
    return (
      <div className="p-4 space-y-6">
        <div className="h-5 w-16 bg-muted rounded" />
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="h-4 w-28 bg-muted rounded" />
              <div className="mt-2 h-3 w-64 bg-muted/70 rounded" />
            </div>
            <div className="h-6 w-10 bg-muted rounded" />
          </div>
          <div>
            <div className="h-4 w-16 bg-muted rounded" />
            <div className="mt-2 flex items-center gap-2">
              <Skeleton className="h-9 w-64" />
              <Skeleton className="h-8 w-16" />
            </div>
            <div className="mt-2 h-3 w-72 bg-muted/70 rounded" />
          </div>
        </div>
      </div>
    )
  }

  if (!systemSettings) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <p>{error || '无法加载系统设置'}</p>
        <Button className="mt-3" variant="outline" onClick={()=>fetchSystemSettings()}>重试</Button>
      </div>
    )
  }

  const handleSyncAnonymousQuota = async () => {
    if (!isAdmin || syncingAnonymousQuota) return
    setSyncingAnonymousQuota(true)
    try {
      await syncAnonymousQuota({ resetUsed: true })
      await fetchSystemSettings()
      toast({ title: '已同步匿名额度', description: '匿名访客额度已更新为当前默认值，并清零今日用量。' })
    } catch (err: any) {
      toast({ title: '同步失败', description: err?.response?.data?.error || err?.message || '操作失败', variant: 'destructive' })
    } finally {
      setSyncingAnonymousQuota(false)
      setSyncDialogOpen(false)
    }
  }

  const handleAssistantAvatarUpload = async ({ data, mime, previewUrl }: AvatarUploadResult) => {
    if (!isAdmin || assistantAvatarSaving) return
    const previous = assistantAvatarPreview
    setAssistantAvatarPreview(previewUrl)
    setAssistantAvatarSaving(true)
    try {
      await updateSystemSettings({ assistantAvatarUpload: { data, mime } })
      toast({ title: 'AI 头像已更新' })
    } catch (error: any) {
      setAssistantAvatarPreview(previous)
      toast({
        title: '上传失败',
        description: error?.response?.data?.error || error?.message || '更新 AI 头像失败',
        variant: 'destructive',
      })
    } finally {
      setAssistantAvatarSaving(false)
    }
  }

  const handleAssistantAvatarClear = async () => {
    if (!isAdmin || assistantAvatarSaving) return
    const previous = assistantAvatarPreview
    setAssistantAvatarPreview(null)
    setAssistantAvatarSaving(true)
    try {
      await updateSystemSettings({ assistantAvatarRemove: true })
      toast({ title: '已恢复默认 AI 头像' })
    } catch (error: any) {
      setAssistantAvatarPreview(previous)
      toast({
        title: '操作失败',
        description: error?.response?.data?.error || error?.message || '恢复默认 AI 头像失败',
        variant: 'destructive',
      })
    } finally {
      setAssistantAvatarSaving(false)
    }
  }

  const normalizedInitials = systemSettings
    ? {
        allowRegistration: Boolean(systemSettings.allowRegistration),
        anonymousQuota: String(systemSettings.anonymousDailyQuota ?? 20),
        defaultUserQuota: String(systemSettings.defaultUserDailyQuota ?? 200),
        battleAllowAnonymous: Boolean(systemSettings.battleAllowAnonymous ?? true),
        battleAllowUsers: Boolean(systemSettings.battleAllowUsers ?? true),
        battleAnonymousQuota: String(systemSettings.battleAnonymousDailyQuota ?? 20),
        battleUserQuota: String(systemSettings.battleUserDailyQuota ?? 200),
        battleRetentionDays: String(systemSettings.battleRetentionDays ?? 15),
        brandText: systemSettings.brandText || '',
        chatSystemPrompt: systemSettings.chatSystemPrompt || '',
        siteBaseUrl: (systemSettings.siteBaseUrl || '').trim(),
        chatImageRetentionDays: String(systemSettings.chatImageRetentionDays ?? 30),
        assistantReplyHistoryLimit: String(systemSettings.assistantReplyHistoryLimit ?? 5),
        anonymousRetentionDays: String(systemSettings.anonymousRetentionDays ?? 15),
        titleSummaryEnabled: Boolean(systemSettings.titleSummaryEnabled),
        titleSummaryMaxLength: systemSettings.titleSummaryMaxLength ?? 20,
        titleSummaryModelSource: systemSettings.titleSummaryModelSource ?? 'current',
      }
    : null

  const fieldChanged =
    normalizedInitials != null &&
    (
      allowRegistrationDraft !== normalizedInitials.allowRegistration ||
      anonymousQuotaDraft !== normalizedInitials.anonymousQuota ||
      defaultUserQuotaDraft !== normalizedInitials.defaultUserQuota ||
      battleAllowAnonymousDraft !== normalizedInitials.battleAllowAnonymous ||
      battleAllowUsersDraft !== normalizedInitials.battleAllowUsers ||
      battleAnonymousQuotaDraft !== normalizedInitials.battleAnonymousQuota ||
      battleUserQuotaDraft !== normalizedInitials.battleUserQuota ||
      battleRetentionDraft !== normalizedInitials.battleRetentionDays ||
      brandTextDraft !== normalizedInitials.brandText ||
      chatSystemPromptDraft !== normalizedInitials.chatSystemPrompt ||
      siteBaseDraft.trim() !== normalizedInitials.siteBaseUrl ||
      retentionDraft !== normalizedInitials.chatImageRetentionDays ||
      replyHistoryLimitDraft !== normalizedInitials.assistantReplyHistoryLimit ||
      anonymousRetentionDraft !== normalizedInitials.anonymousRetentionDays ||
      titleSummaryEnabledDraft !== normalizedInitials.titleSummaryEnabled ||
      titleSummaryMaxLengthDraft !== normalizedInitials.titleSummaryMaxLength ||
      titleSummaryModelSourceDraft !== normalizedInitials.titleSummaryModelSource
    )

  const handleSaveGeneral = async () => {
    if (!systemSettings || !isAdmin || saving) return
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
    const parsedBattleAnonymousQuota = Number.parseInt(battleAnonymousQuotaDraft, 10)
    if (Number.isNaN(parsedBattleAnonymousQuota) || parsedBattleAnonymousQuota < 0) {
      toast({ title: '输入无效', description: '匿名乱斗额度需为不小于 0 的整数', variant: 'destructive' })
      return
    }
    const parsedBattleUserQuota = Number.parseInt(battleUserQuotaDraft, 10)
    if (Number.isNaN(parsedBattleUserQuota) || parsedBattleUserQuota < 0) {
      toast({ title: '输入无效', description: '注册用户乱斗额度需为不小于 0 的整数', variant: 'destructive' })
      return
    }
    const parsedBattleRetentionDays = Number.parseInt(battleRetentionDraft, 10)
    if (Number.isNaN(parsedBattleRetentionDays) || parsedBattleRetentionDays < 0 || parsedBattleRetentionDays > 3650) {
      toast({ title: '输入无效', description: '乱斗历史保留天数需在 0 到 3650 之间', variant: 'destructive' })
      return
    }
    const parsedRetention = Number.parseInt(retentionDraft, 10)
    if (Number.isNaN(parsedRetention) || parsedRetention < 0) {
      toast({ title: '输入无效', description: '图片保留天数需为不小于 0 的整数', variant: 'destructive' })
      return
    }
    const parsedReplyHistoryLimit = Number.parseInt(replyHistoryLimitDraft, 10)
    if (Number.isNaN(parsedReplyHistoryLimit) || parsedReplyHistoryLimit < 1 || parsedReplyHistoryLimit > 20) {
      toast({ title: '输入无效', description: 'AI 回答历史上限需在 1 到 20 之间', variant: 'destructive' })
      return
    }
    const parsedAnonymousRetention = Number.parseInt(anonymousRetentionDraft, 10)
    if (Number.isNaN(parsedAnonymousRetention) || parsedAnonymousRetention < 0 || parsedAnonymousRetention > 15) {
      toast({ title: '输入无效', description: '匿名访客数据保留天数需在 0 到 15 之间', variant: 'destructive' })
      return
    }

    setSaving(true)
    try {
      await updateSystemSettings({
        allowRegistration: allowRegistrationDraft,
        anonymousDailyQuota: parsedAnonymousQuota,
        defaultUserDailyQuota: parsedDefaultQuota,
        battleAllowAnonymous: battleAllowAnonymousDraft,
        battleAllowUsers: battleAllowUsersDraft,
        battleAnonymousDailyQuota: parsedBattleAnonymousQuota,
        battleUserDailyQuota: parsedBattleUserQuota,
        battleRetentionDays: parsedBattleRetentionDays,
        brandText: brandTextDraft,
        chatSystemPrompt: chatSystemPromptDraft,
        siteBaseUrl: siteBaseDraft.trim(),
        chatImageRetentionDays: parsedRetention,
        assistantReplyHistoryLimit: parsedReplyHistoryLimit,
        anonymousRetentionDays: parsedAnonymousRetention,
        titleSummaryEnabled: titleSummaryEnabledDraft,
        titleSummaryMaxLength: titleSummaryMaxLengthDraft,
        titleSummaryModelSource: titleSummaryModelSourceDraft,
      })
      toast({ title: '已保存通用配置' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">

      {/* 用户注册区块 */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b">
          <Palette className="w-5 h-5 text-primary" />
          <div>
            <CardTitle className="text-lg">AI 头像</CardTitle>
            <CardDescription>设置全局生效的 AI 回复头像</CardDescription>
          </div>
        </div>
        <SettingRow
          title="AI 回复头像"
          description="修改后对所有用户立即生效，最大 1MB"
        >
          <AvatarUploadField
            imageUrl={assistantAvatarPreview}
            fallbackText="A"
            uploading={assistantAvatarSaving}
            disabled={!isAdmin}
            clearDisabled={!assistantAvatarPreview}
            onUpload={handleAssistantAvatarUpload}
            onClear={handleAssistantAvatarClear}
            onError={(message) => toast({ title: '上传失败', description: message, variant: 'destructive' })}
          />
        </SettingRow>
      </div>

      {/* 用户注册区块 */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b">
          <UserPlus className="w-5 h-5 text-primary" />
          <div>
            <CardTitle className="text-lg">用户注册</CardTitle>
            <CardDescription>控制新用户的注册和访客访问</CardDescription>
          </div>
        </div>

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

      {/* 模型大乱斗区块 */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b">
          <Swords className="w-5 h-5 text-primary" />
          <div>
            <CardTitle className="text-lg">模型大乱斗</CardTitle>
            <CardDescription>控制乱斗功能的访问与每日次数</CardDescription>
          </div>
        </div>

        <SettingRow
          title="允许匿名用户使用模型大乱斗"
          description="开启后匿名访客可参与模型乱斗"
        >
          <Switch
            id="battleAllowAnonymous"
            checked={battleAllowAnonymousDraft}
            disabled={!isAdmin}
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
              disabled={!isAdmin}
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
            disabled={!isAdmin}
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
              disabled={!isAdmin}
            />
            <span className="text-sm text-muted-foreground whitespace-nowrap">次/天</span>
          </div>
        </SettingRow>
      </div>

      {/* 品牌定制区块 */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b">
          <Palette className="w-5 h-5 text-primary" />
          <div>
            <CardTitle className="text-lg">品牌定制</CardTitle>
            <CardDescription>自定义系统的品牌标识和外观</CardDescription>
          </div>
        </div>

        <SettingRow
          title="文字 LOGO"
          description="显示在页面顶部的品牌名称，最多 40 个字符"
          align="start"
        >
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Input
              id="brandText"
              maxLength={40}
              value={brandTextDraft}
              placeholder="例如：AIChat 或公司名"
              onChange={(e)=>setBrandTextDraft(e.target.value)}
              onCompositionStart={()=>setIsIMEComposing(true)}
              onCompositionEnd={()=>setIsIMEComposing(false)}
              className="w-full sm:w-[320px]"
              disabled={!isAdmin}
            />
          </div>
        </SettingRow>

        <SettingRow
          title="全局系统提示词"
          description="留空则不注入；会话未设置时自动继承（默认上限 12000 字符，可通过后端环境变量调整）"
          align="start"
        >
          <div className="w-full space-y-2">
            <Textarea
              value={chatSystemPromptDraft}
              onChange={(e) => setChatSystemPromptDraft(e.target.value)}
              placeholder="例如：你是一位专业助教，请使用简洁、结构化的回答。"
              rows={4}
              disabled={!isAdmin}
            />
            <p className="text-xs text-muted-foreground">
              {'生效顺序：会话 > 个人 > 全局；支持使用 {day time}（将替换为服务器当前时间）。三层均为空时默认提示词为“今天日期是{day time}”。'}
            </p>
          </div>
        </SettingRow>

        <SettingRow
          title="图片访问域名"
          description="用户上传图片的公开访问地址前缀（需包含协议）"
          align="start"
        >
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Input
              id="chatImageDomain"
              type="text"
              value={siteBaseDraft}
              onChange={(e) => setSiteBaseDraft(e.target.value)}
              placeholder="例如：https://chat.example.com"
              className="w-full sm:w-[320px]"
              disabled={!isAdmin}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                try {
                  const res = await refreshImageAttachments()
                  if (res.success) {
                    const sample = Array.isArray(res.data?.samples) && res.data.samples.length > 0 ? res.data.samples[0].url : '已刷新'
                    toast({ title: '刷新成功', description: `当前域名：${res.data?.baseUrl || '未识别'}\n示例：${sample}` })
                  } else {
                    toast({ title: '刷新失败', description: res.error || '服务器未返回结果', variant: 'destructive' })
                  }
                } catch (error: any) {
                  toast({ title: '刷新失败', description: error?.message || '未知错误', variant: 'destructive' })
                }
              }}
              disabled={!isAdmin}
            >刷新</Button>
          </div>
        </SettingRow>
      </div>

      {/* 数据保留策略区块 */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b">
          <Clock className="w-5 h-5 text-primary" />
          <div>
            <CardTitle className="text-lg">数据保留策略</CardTitle>
            <CardDescription>控制系统数据的自动清理规则</CardDescription>
          </div>
        </div>

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
              disabled={!isAdmin}
            />
            <span className="text-sm text-muted-foreground">天</span>
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
              disabled={!isAdmin}
            />
            <span className="text-sm text-muted-foreground">天</span>
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
              disabled={!isAdmin}
            />
            <span className="text-sm text-muted-foreground">条</span>
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
              disabled={!isAdmin}
            />
            <span className="text-sm text-muted-foreground">天</span>
          </div>
        </SettingRow>
      </div>

      {/* 标题智能总结区块 */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b">
          <Type className="w-5 h-5 text-primary" />
          <div>
            <CardTitle className="text-lg">标题智能总结</CardTitle>
            <CardDescription>使用 AI 自动为对话生成简洁标题</CardDescription>
          </div>
        </div>

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
            disabled={!isAdmin}
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
              disabled={!isAdmin || !titleSummaryEnabledDraft}
            />
            <span className="text-sm text-muted-foreground">字</span>
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
            disabled={!isAdmin || !titleSummaryEnabledDraft}
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

      <div className="flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          onClick={resetDrafts}
          disabled={!fieldChanged || saving || !systemSettings}
        >
          还原更改
        </Button>
        <Button
          onClick={handleSaveGeneral}
          disabled={!fieldChanged || !isAdmin || saving || !systemSettings}
        >
          {saving ? '保存中...' : '保存通用设置'}
        </Button>
      </div>
    </div>
  )
}
