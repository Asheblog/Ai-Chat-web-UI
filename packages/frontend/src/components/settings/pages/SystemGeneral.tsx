"use client"
import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { useSettingsStore } from "@/store/settings-store"
import { useToast } from "@/components/ui/use-toast"

export function SystemGeneralPage() {
  const { systemSettings, fetchSystemSettings, updateSystemSettings } = useSettingsStore()
  const { toast } = useToast()
  const [brandTextDraft, setBrandTextDraft] = useState("")
  const [isIMEComposing, setIsIMEComposing] = useState(false)

  useEffect(() => { fetchSystemSettings() }, [fetchSystemSettings])
  useEffect(() => { if(systemSettings) setBrandTextDraft(systemSettings.brandText || '') }, [systemSettings?.brandText])

  if (!systemSettings) return null

  return (
    <section className="rounded-xl border overflow-hidden">
      <div className="px-4 py-3 font-medium border-b">通用</div>
      <div className="divide-y">
        <div className="flex items-center justify-between px-4 py-3">
          <div>
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
          />
        </div>
        <div className="px-4 py-3">
          <Label htmlFor="brandText" className="font-medium">文字LOGO</Label>
          <div className="mt-2 flex items-center gap-2">
            <Input id="brandText" maxLength={40} value={brandTextDraft}
              placeholder="例如：AIChat 或公司名"
              onChange={(e)=>setBrandTextDraft(e.target.value)}
              onCompositionStart={()=>setIsIMEComposing(true)}
              onCompositionEnd={()=>setIsIMEComposing(false)}
            />
            <Button size="sm" variant="outline" onClick={async()=>{
              await updateSystemSettings({ brandText: brandTextDraft })
              toast({ title: '已保存' })
            }} disabled={brandTextDraft === (systemSettings.brandText||'')}>保存</Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">显示在左上角（类似 ChatGPT），最多 40 个字符。</p>
        </div>
      </div>
    </section>
  )
}

