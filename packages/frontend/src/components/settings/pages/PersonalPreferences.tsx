"use client"
import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { useSettingsStore } from "@/store/settings-store"
import { Edit3, Moon, Monitor, Sun } from "lucide-react"
import { AvatarUploadField, type AvatarUploadResult } from "../components/avatar-upload-field"
import { useAuthStore } from "@/store/auth-store"
import { useToast } from "@/components/ui/use-toast"
import { updatePersonalSettings } from '@/features/settings/api'

export function PersonalPreferencesPage(){
  const {
    theme,
    setTheme,
    contextEnabled,
    setContextEnabled,
    newConversationContextEnabled,
    setNewConversationContextEnabled,
  } = useSettingsStore()
  const { toast } = useToast()
  const { user, fetchActor } = useAuthStore((state) => ({ user: state.user, fetchActor: state.fetchActor }))
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user?.avatarUrl ?? null)
  const [avatarSaving, setAvatarSaving] = useState(false)
  const [username, setUsername] = useState(user?.username ?? "")
  const [usernameSaving, setUsernameSaving] = useState(false)
  const [usernameError, setUsernameError] = useState<string | null>(null)
  const [personalPromptDraft, setPersonalPromptDraft] = useState(user?.personalPrompt ?? "")
  const [personalPromptSaving, setPersonalPromptSaving] = useState(false)
  const [personalPromptError, setPersonalPromptError] = useState<string | null>(null)

  useEffect(() => {
    setAvatarPreview(user?.avatarUrl ?? null)
  }, [user?.avatarUrl])

  useEffect(() => {
    setUsername(user?.username ?? "")
  }, [user?.username])

  useEffect(() => {
    setPersonalPromptDraft(user?.personalPrompt ?? "")
  }, [user?.personalPrompt])

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

  const handlePersonalPromptSave = async (options?: { silent?: boolean }): Promise<boolean> => {
    if (!user || personalPromptSaving) return false
    const normalized = personalPromptDraft.trim()
    const nextPayload = normalized ? normalized : null
    const current = user.personalPrompt ?? null
    if (current === nextPayload) {
      setPersonalPromptError(null)
      return true
    }
    setPersonalPromptSaving(true)
    setPersonalPromptError(null)
    try {
      await updatePersonalSettings({ personalPrompt: nextPayload })
      await fetchActor()
      if (!options?.silent) {
        toast({ title: '个人提示词已更新' })
      }
      return true
    } catch (error: any) {
      const message = error?.response?.data?.error || error?.message || '更新提示词失败'
      setPersonalPromptError(message)
      return false
    } finally {
      setPersonalPromptSaving(false)
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
      <h1 className="text-2xl font-semibold tracking-tight text-slate-950">个人设置</h1>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="v2-panel bg-white/90 p-5 md:p-6">
          <h3 className="v2-section-title">个人资料</h3>
          <div className="mt-5 grid gap-5 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-start">
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
              avatarSize={104}
            />
            <div className="min-w-0 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">用户名</label>
                <div className="relative">
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
                    className="h-10 bg-white pr-10"
                    placeholder="请输入新的用户名"
                    disabled={!user || usernameSaving}
                  />
                  <Edit3 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                </div>
                <p className="text-xs text-slate-400">3-20 个字符，可包含字母、数字和下划线</p>
                {usernameError && <p className="text-sm text-destructive">{usernameError}</p>}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">主题</label>
                <div className="grid grid-cols-3 overflow-hidden rounded-[8px] border border-slate-200 bg-slate-50">
                  {[
                    { value: 'light', label: '浅色', icon: Sun },
                    { value: 'system', label: '跟随系统', icon: Monitor },
                    { value: 'dark', label: '深色', icon: Moon },
                  ].map((item) => {
                    const Icon = item.icon
                    const active = theme === item.value
                    return (
                      <button
                        key={item.value}
                        type="button"
                        className={`flex h-10 items-center justify-center gap-1.5 whitespace-nowrap text-xs transition ${active ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:bg-white/70'}`}
                        onClick={() => setTheme(item.value as any)}
                      >
                        <Icon className="h-4 w-4" />
                        {item.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="v2-panel bg-white/90 p-5 md:p-6">
          <h3 className="v2-section-title">对话与上下文</h3>
          <div className="mt-5 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-slate-800">记住对话上下文</p>
                <p className="mt-1 text-xs text-slate-500">
                  {contextEnabled ? 'AI 将记住所有对话中的上下文信息' : '仅发送当前消息'}
                </p>
              </div>
              <Switch checked={contextEnabled} onCheckedChange={(v)=>setContextEnabled(!!v)} />
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <p className="text-sm font-medium text-slate-800">新对话继承上下文</p>
                <p className="mt-1 text-xs text-slate-500">
                  开启后，新对话将基于最近的上下文
                </p>
              </div>
              <Switch
                checked={newConversationContextEnabled}
                onCheckedChange={(v)=>setNewConversationContextEnabled(!!v)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">个人系统提示词</label>
              <Textarea
                value={personalPromptDraft}
                onChange={(event) => {
                  setPersonalPromptDraft(event.target.value)
                  if (personalPromptError) {
                    setPersonalPromptError(null)
                  }
                }}
                onBlur={() => handlePersonalPromptSave()}
                placeholder="你是一个专业、友善且高效的 AI 助手。"
                className="min-h-[82px] resize-none bg-white"
                disabled={!user || personalPromptSaving}
              />
              {personalPromptError && <p className="text-sm text-destructive">{personalPromptError}</p>}
              <p className="text-right text-xs text-slate-400">{personalPromptDraft.length}/500</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
