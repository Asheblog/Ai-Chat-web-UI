"use client"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { CardTitle, CardDescription } from "@/components/ui/card"
import { useSettingsStore } from "@/store/settings-store"
import { Settings2 } from "lucide-react"
import { SettingRow } from "../components/setting-row"

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

        <SettingRow
          title="主题"
          description="选择浅色或深色模式，也可跟随系统设置"
        >
          <Select value={theme} onValueChange={(v:any)=>setTheme(v)}>
            <SelectTrigger className="w-full sm:w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="system">跟随系统</SelectItem>
              <SelectItem value="light">浅色模式</SelectItem>
              <SelectItem value="dark">深色模式</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
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

        <SettingRow
          title="上下文限制 (Tokens)"
          description="更大值提供更多上下文但消耗更多资源"
        >
          <Input
            id="maxTokens"
            className="w-full sm:w-[220px] text-right"
            type="number"
            min="1000"
            max="32000"
            step="1000"
            value={maxTokens}
            onChange={e=>setMaxTokens(parseInt(e.target.value)||4000)}
          />
        </SettingRow>

        <SettingRow
          title="上下文开关"
          description={
            contextEnabled ? '已开启，会保留历史消息作为对话上下文' : '已关闭，仅发送当前消息不包含历史记录'
          }
        >
          <Switch checked={contextEnabled} onCheckedChange={(v)=>setContextEnabled(!!v)} />
        </SettingRow>
      </div>
    </div>
  )
}
