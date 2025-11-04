"use client"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useSettingsStore } from "@/store/settings-store"

export function PersonalPreferencesPage(){
  const { theme, setTheme, maxTokens, setMaxTokens, contextEnabled, setContextEnabled } = useSettingsStore()
  return (
    <div className="p-4 space-y-6">
      <div className="text-base font-medium">偏好设置</div>
      <div className="space-y-4">
        <div>
          <Label htmlFor="theme" className="font-medium">主题</Label>
          <div className="mt-2">
            <Select value={theme} onValueChange={(v:any)=>setTheme(v)}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="system">跟随系统</SelectItem>
                <SelectItem value="light">浅色模式</SelectItem>
                <SelectItem value="dark">深色模式</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="maxTokens" className="font-medium">上下文限制 (Tokens)</Label>
          <div className="mt-2">
            <Input id="maxTokens" className="w-48" type="number" min="1000" max="32000" step="1000" value={maxTokens} onChange={e=>setMaxTokens(parseInt(e.target.value)||4000)} />
            <p className="text-sm text-muted-foreground mt-1">更大值提供更多上下文但消耗更多资源</p>
          </div>
        </div>
        <div>
          <Label className="font-medium">上下文开关</Label>
          <div className="mt-2 flex items-center space-x-3">
            <Switch checked={contextEnabled} onCheckedChange={(v)=>setContextEnabled(!!v)} />
            <span className="text-sm text-muted-foreground">{contextEnabled ? '已开启，会保留历史消息。' : '已关闭，仅发送当前消息。'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
