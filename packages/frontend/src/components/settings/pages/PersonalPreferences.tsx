"use client"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Card, CardTitle, CardDescription } from "@/components/ui/card"
import { useSettingsStore } from "@/store/settings-store"
import { Settings2 } from "lucide-react"

export function PersonalPreferencesPage(){
  const { theme, setTheme, maxTokens, setMaxTokens, contextEnabled, setContextEnabled } = useSettingsStore()
  return (
    <div className="space-y-6">

      {/* 外观设置区块 */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b">
          <Settings2 className="w-5 h-5 text-primary" />
          <div>
            <CardTitle className="text-lg">外观设置</CardTitle>
            <CardDescription>控制界面主题和显示效果</CardDescription>
          </div>
        </div>

        <Card className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-6 px-4 py-4 sm:px-5 sm:py-5 transition-all hover:border-primary/30 hover:shadow-sm">
          <div className="flex-1">
            <div className="font-medium">主题</div>
            <div className="text-sm text-muted-foreground mt-1.5">选择浅色或深色模式，也可跟随系统设置</div>
          </div>
          <div className="shrink-0 self-start sm:self-auto">
            <Select value={theme} onValueChange={(v:any)=>setTheme(v)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="system">跟随系统</SelectItem>
                <SelectItem value="light">浅色模式</SelectItem>
                <SelectItem value="dark">深色模式</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Card>
      </div>

      {/* 对话设置区块 */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b">
          <Settings2 className="w-5 h-5 text-primary" />
          <div>
            <CardTitle className="text-lg">对话设置</CardTitle>
            <CardDescription>管理对话上下文和历史消息</CardDescription>
          </div>
        </div>

        <Card className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-6 px-4 py-4 sm:px-5 sm:py-5 transition-all hover:border-primary/30 hover:shadow-sm">
          <div className="flex-1">
            <div className="font-medium">上下文限制 (Tokens)</div>
            <div className="text-sm text-muted-foreground mt-1.5">更大值提供更多上下文但消耗更多资源</div>
          </div>
          <div className="shrink-0 self-start sm:self-auto flex items-center gap-2">
            <Input
              id="maxTokens"
              className="w-28 text-right"
              type="number"
              min="1000"
              max="32000"
              step="1000"
              value={maxTokens}
              onChange={e=>setMaxTokens(parseInt(e.target.value)||4000)}
            />
          </div>
        </Card>

        <Card className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-6 px-4 py-4 sm:px-5 sm:py-5 transition-all hover:border-primary/30 hover:shadow-sm">
          <div className="flex-1">
            <div className="font-medium">上下文开关</div>
            <div className="text-sm text-muted-foreground mt-1.5">
              {contextEnabled ? '已开启，会保留历史消息作为对话上下文' : '已关闭，仅发送当前消息不包含历史记录'}
            </div>
          </div>
          <div className="shrink-0 self-start sm:self-auto">
            <Switch checked={contextEnabled} onCheckedChange={(v)=>setContextEnabled(!!v)} />
          </div>
        </Card>
      </div>
    </div>
  )
}
