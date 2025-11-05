"use client"
import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useSettingsStore } from "@/store/settings-store"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/components/ui/use-toast"
import { apiClient } from "@/lib/api"
import { useAuthStore } from "@/store/auth-store"
import { UserPlus, Palette, Clock } from "lucide-react"

export function SystemGeneralPage() {
  const { systemSettings, fetchSystemSettings, updateSystemSettings, isLoading, error } = useSettingsStore()
  const { toast } = useToast()
  const { actorState, user } = useAuthStore((state) => ({
    actorState: state.actorState,
    user: state.user,
  }))
  const isAdmin = actorState === 'authenticated' && user?.role === 'ADMIN'
  const [brandTextDraft, setBrandTextDraft] = useState("")
  const [, setIsIMEComposing] = useState(false)
  const [retentionDraft, setRetentionDraft] = useState('30')
  const [siteBaseDraft, setSiteBaseDraft] = useState('')
  const [anonymousQuotaDraft, setAnonymousQuotaDraft] = useState('20')
  const [defaultUserQuotaDraft, setDefaultUserQuotaDraft] = useState('200')
  const [anonymousRetentionDraft, setAnonymousRetentionDraft] = useState('15')
  const [syncingAnonymousQuota, setSyncingAnonymousQuota] = useState(false)

  useEffect(() => { fetchSystemSettings() }, [fetchSystemSettings])
  useEffect(() => {
    if (systemSettings) {
      setBrandTextDraft(systemSettings.brandText || '')
      setRetentionDraft(String(systemSettings.chatImageRetentionDays ?? 30))
      setSiteBaseDraft(systemSettings.siteBaseUrl || '')
      if (typeof systemSettings.anonymousDailyQuota === 'number') {
        setAnonymousQuotaDraft(String(systemSettings.anonymousDailyQuota))
      }
      if (typeof systemSettings.defaultUserDailyQuota === 'number') {
        setDefaultUserQuotaDraft(String(systemSettings.defaultUserDailyQuota))
      }
      if (typeof systemSettings.anonymousRetentionDays === 'number') {
        setAnonymousRetentionDraft(String(systemSettings.anonymousRetentionDays))
      }
    }
  }, [systemSettings])

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
        <button className="mt-3 px-3 py-2 border rounded" onClick={()=>fetchSystemSettings()}>重试</button>
      </div>
    )
  }

  const handleSyncAnonymousQuota = async () => {
    if (!isAdmin || syncingAnonymousQuota) return
    const confirmed = typeof window === 'undefined' ? true : window.confirm('是否同步匿名访客额度？该操作会重置匿名访客今日已用额度。')
    if (!confirmed) return
    setSyncingAnonymousQuota(true)
    try {
      await apiClient.syncAnonymousQuota({ resetUsed: true })
      await fetchSystemSettings()
      toast({ title: '已同步匿名额度', description: '匿名访客额度已更新为当前默认值，并清零今日用量。' })
    } catch (err: any) {
      toast({ title: '同步失败', description: err?.response?.data?.error || err?.message || '操作失败', variant: 'destructive' })
    } finally {
      setSyncingAnonymousQuota(false)
    }
  }

  return (
    <div className="space-y-6">

      {/* 用户注册区块 */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b">
          <UserPlus className="w-5 h-5 text-primary" />
          <div>
            <h3 className="text-lg font-semibold">用户注册</h3>
            <p className="text-sm text-muted-foreground">控制新用户的注册和访客访问</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-6 px-5 py-5 rounded-lg border border-border bg-card transition-all hover:border-primary/30 hover:shadow-sm">
          <div className="flex-1">
            <div className="font-medium flex items-center gap-2">
              开放用户注册
              <Badge variant="secondary">推荐</Badge>
            </div>
            <div className="text-sm text-muted-foreground mt-1.5">允许新用户自行注册账号，关闭后只能由管理员手动创建用户</div>
          </div>
          <div className="shrink-0">
            <Switch
              id="allowRegistration"
              checked={systemSettings.allowRegistration}
              disabled={!isAdmin}
              onCheckedChange={async (checked) => {
                if (!isAdmin) return
                await updateSystemSettings({ allowRegistration: checked })
                toast({ title: '已保存' })
              }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-6 px-5 py-5 rounded-lg border border-border bg-card transition-all hover:border-primary/30 hover:shadow-sm">
          <div className="flex-1">
            <div className="font-medium">匿名访客每日额度</div>
            <div className="text-sm text-muted-foreground mt-1.5">未登录用户每天可使用的对话次数（设置为 0 表示禁用匿名访问）</div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <Input
              id="anonymousDailyQuota"
              type="number"
              min={0}
              value={anonymousQuotaDraft}
              onChange={(e) => setAnonymousQuotaDraft(e.target.value)}
              className="w-20 text-right"
              disabled={!isAdmin}
            />
            <span className="text-sm text-muted-foreground whitespace-nowrap">次/天</span>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                if (!isAdmin) return
                const parsed = Number.parseInt(anonymousQuotaDraft, 10)
                if (Number.isNaN(parsed) || parsed < 0) {
                  toast({ title: '输入无效', description: '请输入不小于 0 的整数', variant: 'destructive' })
                  return
                }
                await updateSystemSettings({ anonymousDailyQuota: parsed })
                toast({ title: '已保存' })
              }}
              disabled={!isAdmin || (() => {
                const parsed = Number.parseInt(anonymousQuotaDraft, 10)
                if (Number.isNaN(parsed)) return true
                return parsed === (systemSettings.anonymousDailyQuota ?? 20)
              })()}
            >保存</Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleSyncAnonymousQuota}
              disabled={!isAdmin || syncingAnonymousQuota}
            >{syncingAnonymousQuota ? '同步中...' : '同步'}</Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-6 px-5 py-5 rounded-lg border border-border bg-card transition-all hover:border-primary/30 hover:shadow-sm">
          <div className="flex-1">
            <div className="font-medium">注册用户默认每日额度</div>
            <div className="text-sm text-muted-foreground mt-1.5">新注册用户的初始每日对话额度，可在用户管理中单独调整</div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <Input
              id="defaultUserDailyQuota"
              type="number"
              min={0}
              value={defaultUserQuotaDraft}
              onChange={(e) => setDefaultUserQuotaDraft(e.target.value)}
              className="w-20 text-right"
              disabled={!isAdmin}
            />
            <span className="text-sm text-muted-foreground whitespace-nowrap">次/天</span>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                if (!isAdmin) return
                const parsed = Number.parseInt(defaultUserQuotaDraft, 10)
                if (Number.isNaN(parsed) || parsed < 0) {
                  toast({ title: '输入无效', description: '请输入不小于 0 的整数', variant: 'destructive' })
                  return
                }
                await updateSystemSettings({ defaultUserDailyQuota: parsed })
                toast({ title: '已保存' })
              }}
              disabled={!isAdmin || (() => {
                const parsed = Number.parseInt(defaultUserQuotaDraft, 10)
                if (Number.isNaN(parsed)) return true
                return parsed === (systemSettings.defaultUserDailyQuota ?? 200)
              })()}
            >保存</Button>
          </div>
        </div>
      </div>

      {/* 品牌定制区块 */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b">
          <Palette className="w-5 h-5 text-primary" />
          <div>
            <h3 className="text-lg font-semibold">品牌定制</h3>
            <p className="text-sm text-muted-foreground">自定义系统的品牌标识和外观</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-6 px-5 py-5 rounded-lg border border-border bg-card transition-all hover:border-primary/30 hover:shadow-sm">
          <div className="flex-1">
            <div className="font-medium">文字 LOGO</div>
            <div className="text-sm text-muted-foreground mt-1.5">显示在页面顶部的品牌名称，最多 40 个字符</div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <Input
              id="brandText"
              maxLength={40}
              value={brandTextDraft}
              placeholder="例如：AIChat 或公司名"
              onChange={(e)=>setBrandTextDraft(e.target.value)}
              onCompositionStart={()=>setIsIMEComposing(true)}
              onCompositionEnd={()=>setIsIMEComposing(false)}
              className="w-60"
              disabled={!isAdmin}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={async()=>{
                if (!isAdmin) return
                await updateSystemSettings({ brandText: brandTextDraft })
                toast({ title: '已保存' })
              }}
              disabled={!isAdmin || brandTextDraft === (systemSettings.brandText||'')}
            >保存</Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-6 px-5 py-5 rounded-lg border border-border bg-card transition-all hover:border-primary/30 hover:shadow-sm">
          <div className="flex-1">
            <div className="font-medium">图片访问域名</div>
            <div className="text-sm text-muted-foreground mt-1.5">用户上传图片的公开访问地址前缀（需包含协议）</div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <Input
              id="chatImageDomain"
              type="text"
              value={siteBaseDraft}
              onChange={(e) => setSiteBaseDraft(e.target.value)}
              placeholder="例如：https://chat.example.com"
              className="w-80"
              disabled={!isAdmin}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                if (!isAdmin) return
                await updateSystemSettings({ siteBaseUrl: siteBaseDraft.trim() })
                toast({ title: '已保存', description: '新域名将用于生成图片链接' })
              }}
              disabled={!isAdmin || siteBaseDraft.trim() === (systemSettings.siteBaseUrl || '').trim()}
            >保存</Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                try {
                  const res = await apiClient.refreshImageAttachments()
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
        </div>
      </div>

      {/* 数据保留策略区块 */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b">
          <Clock className="w-5 h-5 text-primary" />
          <div>
            <h3 className="text-lg font-semibold">数据保留策略</h3>
            <p className="text-sm text-muted-foreground">控制系统数据的自动清理规则</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-6 px-5 py-5 rounded-lg border border-border bg-card transition-all hover:border-primary/30 hover:shadow-sm">
          <div className="flex-1">
            <div className="font-medium flex items-center gap-2">
              聊天图片保留天数
              <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">存储优化</Badge>
            </div>
            <div className="text-sm text-muted-foreground mt-1.5">超过此天数的聊天图片将被自动清理（设置为 0 表示永久保留）</div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <Input
              id="chatImageRetentionDays"
              type="number"
              inputMode="numeric"
              min={0}
              max={3650}
              value={retentionDraft}
              onChange={(e) => setRetentionDraft(e.target.value)}
              className="w-20 text-right"
              disabled={!isAdmin}
            />
            <span className="text-sm text-muted-foreground">天</span>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                if (!isAdmin) return
                const parsed = Number.parseInt(retentionDraft, 10)
                if (Number.isNaN(parsed) || parsed < 0) {
                  toast({ title: '输入无效', description: '请输入不小于 0 的整数', variant: 'destructive' })
                  return
                }
                await updateSystemSettings({ chatImageRetentionDays: parsed })
                toast({ title: '已保存' })
              }}
              disabled={!isAdmin || (() => {
                const parsed = Number.parseInt(retentionDraft, 10)
                if (Number.isNaN(parsed) || parsed < 0) return true
                return parsed === (systemSettings.chatImageRetentionDays ?? 30)
              })()}
            >保存</Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-6 px-5 py-5 rounded-lg border border-border bg-card transition-all hover:border-primary/30 hover:shadow-sm">
          <div className="flex-1">
            <div className="font-medium">匿名访客数据保留天数</div>
            <div className="text-sm text-muted-foreground mt-1.5">匿名用户的聊天记录保留时长（设置为 0 表示永久保留）</div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <Input
              id="anonymousRetentionDays"
              type="number"
              min={0}
              max={15}
              value={anonymousRetentionDraft}
              onChange={(e) => setAnonymousRetentionDraft(e.target.value)}
              className="w-20 text-right"
              disabled={!isAdmin}
            />
            <span className="text-sm text-muted-foreground">天</span>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                if (!isAdmin) return
                const parsed = Number.parseInt(anonymousRetentionDraft, 10)
                if (Number.isNaN(parsed) || parsed < 0 || parsed > 15) {
                  toast({ title: '输入无效', description: '请输入 0 到 15 之间的整数', variant: 'destructive' })
                  return
                }
                await updateSystemSettings({ anonymousRetentionDays: parsed })
                toast({ title: '已保存' })
              }}
              disabled={!isAdmin || (() => {
                const parsed = Number.parseInt(anonymousRetentionDraft, 10)
                if (Number.isNaN(parsed)) return true
                return parsed === (systemSettings.anonymousRetentionDays ?? 15)
              })()}
            >保存</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
