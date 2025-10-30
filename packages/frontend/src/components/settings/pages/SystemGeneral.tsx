"use client"
import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { useSettingsStore } from "@/store/settings-store"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/components/ui/use-toast"
import { apiClient } from "@/lib/api"
import { useAuthStore } from "@/store/auth-store"

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

  return (
    <div className="p-4 space-y-6">
      <div className="text-base font-medium">通用</div>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="font-medium">允许用户注册</div>
            <p className="text-sm text-muted-foreground">关闭后将禁止新用户注册，仅管理员可创建用户</p>
          </div>
          <Switch
            id="allowRegistration"
            checked={systemSettings.allowRegistration}
            disabled={!isAdmin}
            onCheckedChange={async (checked) => {
              if (!isAdmin) return
              await updateSystemSettings({ allowRegistration: checked })
              toast({ title: '已保存' })
            }}
            className="sm:self-auto self-start"
          />
        </div>
        <div>
          <Label htmlFor="brandText" className="font-medium">文字LOGO</Label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input id="brandText" maxLength={40} value={brandTextDraft}
              placeholder="例如：AIChat 或公司名"
              onChange={(e)=>setBrandTextDraft(e.target.value)}
              onCompositionStart={()=>setIsIMEComposing(true)}
              onCompositionEnd={()=>setIsIMEComposing(false)}
              className="w-full sm:max-w-xs"
              disabled={!isAdmin}
            />
            <Button size="sm" variant="outline" onClick={async()=>{
              if (!isAdmin) return
              await updateSystemSettings({ brandText: brandTextDraft })
              toast({ title: '已保存' })
            }} disabled={!isAdmin || brandTextDraft === (systemSettings.brandText||'')} className="w-full sm:w-auto">保存</Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">显示在左上角（类似 ChatGPT），最多 40 个字符。</p>
        </div>
        <div className="space-y-2">
          <div className="font-medium">聊天图片保留天数</div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              id="chatImageRetentionDays"
              type="number"
              inputMode="numeric"
              min={0}
              max={3650}
              value={retentionDraft}
              onChange={(e) => setRetentionDraft(e.target.value)}
              className="w-full sm:max-w-[120px]"
              disabled={!isAdmin}
            />
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
              className="w-full sm:w-auto"
            >保存</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            默认 30 天，可设为 0 表示立即清理（上传后仅当前会话保留）。超过设置天数的图片会在新消息写入时异步清理。
          </p>
        </div>
        <div className="space-y-2">
          <div className="font-medium">匿名访客数据保留天数</div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              id="anonymousRetentionDays"
              type="number"
              min={0}
              max={15}
              value={anonymousRetentionDraft}
              onChange={(e) => setAnonymousRetentionDraft(e.target.value)}
              className="w-full sm:max-w-[120px]"
              disabled={!isAdmin}
            />
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
              className="w-full sm:w-auto"
            >保存</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            新匿名访客 Cookie 将使用该值作为保留期，超过设定天数的匿名会话与附件会在新消息写入时清理；0 表示仅保留当次会话。
          </p>
        </div>
        <div className="space-y-2">
          <div className="font-medium">匿名访客每日额度</div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              id="anonymousDailyQuota"
              type="number"
              min={0}
              value={anonymousQuotaDraft}
              onChange={(e) => setAnonymousQuotaDraft(e.target.value)}
              className="w-full sm:max-w-[140px]"
              disabled={!isAdmin}
            />
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
              className="w-full sm:w-auto"
            >保存</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            匿名访问者每日可发送的消息上限，超出后会提示登录或等待次日重置。
          </p>
        </div>
        <div className="space-y-2">
          <div className="font-medium">注册用户默认每日额度</div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              id="defaultUserDailyQuota"
              type="number"
              min={0}
              value={defaultUserQuotaDraft}
              onChange={(e) => setDefaultUserQuotaDraft(e.target.value)}
              className="w-full sm:max-w-[140px]"
              disabled={!isAdmin}
            />
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
              className="w-full sm:w-auto"
            >保存</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            新注册用户或未配置单独额度的用户将沿用该默认限制，可在用户管理中为单个用户调整。
          </p>
        </div>
        <div className="space-y-2">
          <div className="font-medium">图片访问域名</div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              id="chatImageDomain"
              type="text"
              value={siteBaseDraft}
              onChange={(e) => setSiteBaseDraft(e.target.value)}
              placeholder="例如：https://chat.example.com"
              className="w-full sm:max-w-xl"
              disabled={!isAdmin}
            />
            <div className="flex gap-2 w-full sm:w-auto">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  if (!isAdmin) return
                  await updateSystemSettings({ siteBaseUrl: siteBaseDraft.trim() })
                  toast({ title: '已保存', description: '新域名将用于生成图片链接' })
                }}
                disabled={!isAdmin || siteBaseDraft.trim() === (systemSettings.siteBaseUrl || '').trim()}
                className="flex-1 sm:flex-initial"
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
                className="flex-1 sm:flex-initial"
              >刷新图片链接</Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            若留空，将尝试使用请求头或局域网 IP 生成地址；保存后可点击“刷新图片链接”生成示例并验证。
          </p>
        </div>
      </div>
    </div>
  )
}
