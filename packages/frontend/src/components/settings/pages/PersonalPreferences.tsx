"use client"
import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { CardTitle, CardDescription } from "@/components/ui/card"
import { useSettingsStore } from "@/store/settings-store"
import { Settings2, Save } from "lucide-react"
import { SettingRow } from "../components/setting-row"
import { AvatarUploadField, type AvatarUploadResult } from "../components/avatar-upload-field"
import { useAuthStore } from "@/store/auth-store"
import { useToast } from "@/components/ui/use-toast"
import { apiClient } from "@/lib/api"
import { Button } from "@/components/ui/button"

export function PersonalPreferencesPage(){
  const { theme, setTheme, maxTokens, setMaxTokens, contextEnabled, setContextEnabled } = useSettingsStore()
  const { toast } = useToast()
  const { user, fetchActor } = useAuthStore((state) => ({ user: state.user, fetchActor: state.fetchActor }))
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user?.avatarUrl ?? null)
  const [avatarSaving, setAvatarSaving] = useState(false)
  const [username, setUsername] = useState(user?.username ?? "")
  const [usernameSaving, setUsernameSaving] = useState(false)
  const [usernameError, setUsernameError] = useState<string | null>(null)
  const [preferencesSaving, setPreferencesSaving] = useState(false)

  useEffect(() => {
    setAvatarPreview(user?.avatarUrl ?? null)
  }, [user?.avatarUrl])

  useEffect(() => {
    setUsername(user?.username ?? "")
  }, [user?.username])

  const validateUsername = (value: string) => {
    if (!value.trim()) return "用户名不能为空"
    const pattern = /^[a-zA-Z0-9_]{3,20}$/
    if (!pattern.test(value.trim())) return "用户名需为3-20位字母、数字或下划线"
    return null
  }

  const handleUsernameSave = async (options?: { silent?: boolean }): Promise<boolean> => {
    if (!user || usernameSaving) return false
    const trimmed = username.trim()
    if (trimmed === (user?.username || "")) {
      setUsernameError(null)
      return true
    }
    const msg = validateUsername(trimmed)
    if (msg) {
      setUsernameError(msg)
      return false
    }
    setUsernameSaving(true)
    setUsernameError(null)
    try {
      await apiClient.updatePersonalSettings({ username: trimmed })
      await fetchActor()
      if (!options?.silent) {
        toast({ title: '用户名已更新' })
      }
      return true
    } catch (error: any) {
      const message = error?.response?.data?.error || error?.message || '更新用户名失败'
      setUsernameError(message)
      return false
    } finally {
      setUsernameSaving(false)
    }
  }

  const handleSavePreferences = async () => {
    if (!user || preferencesSaving) return
    setPreferencesSaving(true)
    try {
      const usernameOk = await handleUsernameSave({ silent: true })
      if (usernameOk) {
        toast({ title: '偏好设置已保存' })
      }
    } finally {
      setPreferencesSaving(false)
    }
  }

  const handleAvatarUpload = async ({ data, mime, previewUrl }: AvatarUploadResult) => {
    if (!user || avatarSaving) return
    const previous = avatarPreview
    setAvatarPreview(previewUrl)
    setAvatarSaving(true)
    try {
      await apiClient.updatePersonalSettings({ avatar: { data, mime } })
      await fetchActor()
      toast({ title: '头像已更新' })
    } catch (error: any) {
      setAvatarPreview(previous)
      toast({
        title: '上传失败',
        description: error?.response?.data?.error || error?.message || '更新头像失败',
        variant: 'destructive',
      })
    } finally {
      setAvatarSaving(false)
    }
  }

  const handleAvatarClear = async () => {
    if (!user || avatarSaving) return
    const previous = avatarPreview
    setAvatarPreview(null)
    setAvatarSaving(true)
    try {
      await apiClient.updatePersonalSettings({ avatar: null })
      await fetchActor()
      toast({ title: '已恢复默认头像' })
    } catch (error: any) {
      setAvatarPreview(previous)
      toast({
        title: '操作失败',
        description: error?.response?.data?.error || error?.message || '恢复默认头像失败',
        variant: 'destructive',
      })
    } finally {
      setAvatarSaving(false)
    }
  }
  return (
    <div className="space-y-6">

      {/* 个人资料区块 */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b">
          <Settings2 className="w-5 h-5 text-primary" />
          <div>
            <CardTitle className="text-lg">个人资料</CardTitle>
            <CardDescription>上传头像以便在菜单和对话中展示</CardDescription>
          </div>
        </div>
        <SettingRow
          title="用户头像"
          description="支持 JPG/PNG/WebP，大小不超过 1MB"
        >
          <AvatarUploadField
            imageUrl={avatarPreview}
            fallbackText={user?.username?.charAt(0).toUpperCase() || 'U'}
            uploading={avatarSaving}
            disabled={!user}
            onUpload={handleAvatarUpload}
            onClear={handleAvatarClear}
            clearDisabled={!avatarPreview && !user?.avatarUrl}
            onError={(message) => toast({ title: '上传失败', description: message, variant: 'destructive' })}
          />
        </SettingRow>

        <SettingRow
          title="用户名"
          description="用于登录和展示，可修改默认管理员用户名"
          align="start"
        >
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onBlur={handleUsernameSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleUsernameSave()
              }
            }}
            className="w-full sm:w-[240px]"
            placeholder="请输入新的用户名"
            disabled={!user || usernameSaving}
          />
          {usernameError && (
            <p className="mt-2 text-sm text-destructive">{usernameError}</p>
          )}
        </SettingRow>
      </div>

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

      <div className="flex justify-end pt-4">
        <Button
          type="button"
          onClick={handleSavePreferences}
          disabled={!user || preferencesSaving || usernameSaving || avatarSaving}
          className="w-full sm:w-auto"
        >
          {preferencesSaving ? '保存中...' : (
            <>
              <Save className="w-4 h-4 mr-2" />
              保存偏好设置
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
