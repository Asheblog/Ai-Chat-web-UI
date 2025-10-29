"use client"
import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { useSettingsStore } from "@/store/settings-store"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/components/ui/use-toast"

export function SystemGeneralPage() {
  const { systemSettings, fetchSystemSettings, updateSystemSettings, isLoading, error } = useSettingsStore()
  const { toast } = useToast()
  const [brandTextDraft, setBrandTextDraft] = useState("")
  const [isIMEComposing, setIsIMEComposing] = useState(false)

  useEffect(() => { fetchSystemSettings() }, [fetchSystemSettings])
  useEffect(() => {
    if (systemSettings) {
      setBrandTextDraft(systemSettings.brandText || '')
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
            onCheckedChange={async (checked) => {
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
            />
            <Button size="sm" variant="outline" onClick={async()=>{
              await updateSystemSettings({ brandText: brandTextDraft })
              toast({ title: '已保存' })
            }} disabled={brandTextDraft === (systemSettings.brandText||'')} className="w-full sm:w-auto">保存</Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">显示在左上角（类似 ChatGPT），最多 40 个字符。</p>
        </div>
      </div>
    </div>
  )
}
