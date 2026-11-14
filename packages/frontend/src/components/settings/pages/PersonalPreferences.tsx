"use client"
import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { Input } from "@/components/ui/input"
import { Edit3, Monitor, Moon, Sun } from "lucide-react"
import { AvatarUploadField, type AvatarUploadResult } from "../components/avatar-upload-field"
import { SettingRow } from "../components/setting-row"
import { SETTINGS_CARD, SETTINGS_CARD_BODY, SETTINGS_CARD_DESCRIPTION, SETTINGS_CARD_HEADER, SETTINGS_CARD_TITLE } from "../components/settings-surfaces"
import { useAuthStore } from "@/store/auth-store"
import { useToast } from "@/components/ui/use-toast"
import { updatePersonalSettings } from '@/features/settings/api'
import { ConversationContextCard } from "./personal-preferences/conversation-context-card"

export function PersonalPreferencesPage(){
  const { theme, setTheme } = useTheme()
  const { toast } = useToast()
  const { user, fetchActor } = useAuthStore((state) => ({ user: state.user, fetchActor: state.fetchActor }))
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user?.avatarUrl ?? null)
  const [avatarSaving, setAvatarSaving] = useState(false)
  const [username, setUsername] = useState(user?.username ?? "")
  const [usernameSaving, setUsernameSaving] = useState(false)
  const [usernameError, setUsernameError] = useState<string | null>(null)

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
      await updatePersonalSettings({ username: trimmed })
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

  const handleAvatarUpload = async ({ data, mime, previewUrl }: AvatarUploadResult) => {
    if (!user || avatarSaving) return
    const previous = avatarPreview
    setAvatarPreview(previewUrl)
    setAvatarSaving(true)
    try {
      await updatePersonalSettings({ avatar: { data, mime } })
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
      await updatePersonalSettings({ avatar: null })
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
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-[-0.3px] text-foreground">个人设置</h1>
      <section className={SETTINGS_CARD}>
        <div className={SETTINGS_CARD_HEADER}>
          <div className="min-w-0">
            <h2 className={SETTINGS_CARD_TITLE}>个人资料</h2>
            <p className={SETTINGS_CARD_DESCRIPTION}>管理你的头像、用户名与界面主题</p>
          </div>
        </div>
        <div className={SETTINGS_CARD_BODY + " space-y-4"}>
          <SettingRow title="头像" align="start">
            <AvatarUploadField
              variant="profile"
              imageUrl={avatarPreview}
              fallbackText={user?.username?.charAt(0).toUpperCase() || 'U'}
              uploading={avatarSaving}
              disabled={!user}
              onUpload={handleAvatarUpload}
              onClear={handleAvatarClear}
              clearDisabled={!avatarPreview && !user?.avatarUrl}
              onError={(message) => toast({ title: '上传失败', description: message, variant: 'destructive' })}
              avatarSize={48}
              className="items-start text-left"
            />
          </SettingRow>
          <SettingRow title="用户名" description="3-20 个字符，可包含字母、数字和下划线" align="start">
            <div className="relative w-full max-w-[320px]">
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onBlur={() => handleUsernameSave()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleUsernameSave()
                  }
                }}
                className="h-9 pr-9 text-[13px]"
                placeholder="请输入新的用户名"
                disabled={!user || usernameSaving}
                aria-label="用户名"
                aria-invalid={usernameError ? true : undefined}
              />
              <Edit3 className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-tertiary" aria-hidden="true" />
            </div>
            {usernameError && <p className="mt-1.5 text-[11.5px] text-destructive">{usernameError}</p>}
          </SettingRow>
          <SettingRow title="界面主题" description="跟随系统会读取操作系统设置">
            <div className="inline-flex gap-1 rounded-lg border border-border bg-surface-subtle p-1">
              {[{ value: "light", label: "浅色", icon: Sun }, { value: "system", label: "跟随系统", icon: Monitor }, { value: "dark", label: "深色", icon: Moon }].map((item) => {
                const Icon = item.icon
                const active = theme === item.value
                return (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={active}
                    className={`inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-[13px] transition-colors duration-[160ms] ${active ? 'border-border bg-surface font-medium text-foreground' : 'border-transparent text-ink-secondary hover:text-foreground'}`}
                    onClick={() => setTheme(item.value as "light" | "system" | "dark")}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    {item.label}
                  </button>
                )
              })}
            </div>
          </SettingRow>
        </div>
      </section>
      <ConversationContextCard />
    </div>
  )
}
