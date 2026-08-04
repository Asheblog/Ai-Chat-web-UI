"use client"

import { useState } from "react"
import { Palette } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { useAuthStore } from "@/store/auth-store"
import { FeatureCard } from "@/components/settings/components/feature-card"
import { SettingRow } from "@/components/settings/components/setting-row"
import { AvatarUploadField, type AvatarUploadResult } from "@/components/settings/components/avatar-upload-field"
import type { SystemSettings } from "@/types"

export interface AvatarCardProps {
  settings: SystemSettings
  update: (payload: Partial<SystemSettings>) => Promise<void>
}

/**
 * AI 头像卡：上传/清除即存（assistantAvatarUpload/assistantAvatarRemove 立即保存），
 * 无主开关无 footer。适配自 SystemGeneralPage AI 头像区块（338-362）。
 */
export function AvatarCard({ settings, update }: AvatarCardProps) {
  const { toast } = useToast()
  const { actorState, user } = useAuthStore((state) => ({
    actorState: state.actorState,
    user: state.user,
  }))
  const isAdmin = actorState === 'authenticated' && user?.role === 'ADMIN'
  const [assistantAvatarPreview, setAssistantAvatarPreview] = useState<string | null>(
    settings.assistantAvatarUrl || null,
  )
  const [assistantAvatarSaving, setAssistantAvatarSaving] = useState(false)

  const handleAssistantAvatarUpload = async ({ data, mime, previewUrl }: AvatarUploadResult) => {
    if (!isAdmin || assistantAvatarSaving) return
    const previous = assistantAvatarPreview
    setAssistantAvatarPreview(previewUrl)
    setAssistantAvatarSaving(true)
    try {
      await update({ assistantAvatarUpload: { data, mime } })
      toast({ title: 'AI 头像已更新' })
    } catch (error: any) {
      setAssistantAvatarPreview(previous)
      toast({
        title: '上传失败',
        description: error?.response?.data?.error || error?.message || '更新 AI 头像失败',
        variant: 'destructive',
      })
    } finally {
      setAssistantAvatarSaving(false)
    }
  }

  const handleAssistantAvatarClear = async () => {
    if (!isAdmin || assistantAvatarSaving) return
    const previous = assistantAvatarPreview
    setAssistantAvatarPreview(null)
    setAssistantAvatarSaving(true)
    try {
      await update({ assistantAvatarRemove: true })
      toast({ title: '已恢复默认 AI 头像' })
    } catch (error: any) {
      setAssistantAvatarPreview(previous)
      toast({
        title: '操作失败',
        description: error?.response?.data?.error || error?.message || '恢复默认 AI 头像失败',
        variant: 'destructive',
      })
    } finally {
      setAssistantAvatarSaving(false)
    }
  }

  return (
    <FeatureCard
      icon={Palette}
      title="AI 头像"
      description="设置全局生效的 AI 回复头像"
      cardKey="branding:avatar"
    >
      <SettingRow
        title="AI 回复头像"
        description="修改后对所有用户立即生效，最大 1MB"
      >
        <AvatarUploadField
          imageUrl={assistantAvatarPreview}
          fallbackText="A"
          uploading={assistantAvatarSaving}
          disabled={!isAdmin}
          clearDisabled={!assistantAvatarPreview}
          onUpload={handleAssistantAvatarUpload}
          onClear={handleAssistantAvatarClear}
          onError={(message) => toast({ title: '上传失败', description: message, variant: 'destructive' })}
        />
      </SettingRow>
    </FeatureCard>
  )
}
