"use client"

import { useCallback, useEffect, useState } from "react"
import { Type } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/use-toast"
import { useAuthStore } from "@/store/auth-store"
import { refreshImageAttachments } from "@/features/settings/api"
import { FeatureCard } from "@/components/settings/components/feature-card"
import { SettingRow } from "@/components/settings/components/setting-row"
import type { SystemSettings } from "@/types"

export interface BrandingCardProps {
  settings: SystemSettings
  update: (payload: Partial<SystemSettings>) => Promise<void>
}

/**
 * 品牌定制卡：3 个 key（brandText/chatSystemPrompt/siteBaseUrl），
 * draft/fieldChanged 模式 + 图片访问域名刷新按钮，
 * 适配自 SystemGeneralPage 品牌定制区块（533-551/553-570/627-661）。
 * 上下文压缩行不在此卡（属数据与维护页），未移植。
 */
export function BrandingCard({ settings, update }: BrandingCardProps) {
  const { toast } = useToast()
  const { actorState, user } = useAuthStore((state) => ({
    actorState: state.actorState,
    user: state.user,
  }))
  const isAdmin = actorState === 'authenticated' && user?.role === 'ADMIN'
  const [brandTextDraft, setBrandTextDraft] = useState("")
  const [, setIsIMEComposing] = useState(false)
  const [chatSystemPromptDraft, setChatSystemPromptDraft] = useState('')
  const [siteBaseDraft, setSiteBaseDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const resetDrafts = useCallback(() => {
    setBrandTextDraft(settings.brandText || '')
    setChatSystemPromptDraft(settings.chatSystemPrompt || '')
    setSiteBaseDraft(settings.siteBaseUrl || '')
  }, [settings])

  useEffect(() => {
    resetDrafts()
  }, [resetDrafts])

  const normalizedInitials = {
    brandText: settings.brandText || '',
    chatSystemPrompt: settings.chatSystemPrompt || '',
    siteBaseUrl: (settings.siteBaseUrl || '').trim(),
  }

  const fieldChanged =
    brandTextDraft !== normalizedInitials.brandText ||
    chatSystemPromptDraft !== normalizedInitials.chatSystemPrompt ||
    siteBaseDraft.trim() !== normalizedInitials.siteBaseUrl

  const handleSave = async () => {
    if (!isAdmin || saving) return
    setSaving(true)
    try {
      await update({
        brandText: brandTextDraft,
        chatSystemPrompt: chatSystemPromptDraft,
        siteBaseUrl: siteBaseDraft.trim(),
      })
      toast({ title: '已保存品牌设置' })
    } finally {
      setSaving(false)
    }
  }

  const handleRefreshImageAttachments = async () => {
    try {
      const res = await refreshImageAttachments()
      if (res.success) {
        const sample = Array.isArray(res.data?.samples) && res.data.samples.length > 0 ? res.data.samples[0].url : '已刷新'
        toast({ title: '刷新成功', description: `当前域名：${res.data?.baseUrl || '未识别'}\n示例：${sample}` })
      } else {
        toast({ title: '刷新失败', description: res.error || '服务器未返回结果', variant: 'destructive' })
      }
    } catch (error: any) {
      toast({ title: '刷新失败', description: error?.message || '未知错误', variant: 'destructive' })
    }
  }

  return (
    <FeatureCard
      icon={Type}
      title="品牌定制"
      description="自定义系统的品牌标识和外观"
      cardKey="branding:branding"
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button onClick={handleSave} disabled={!fieldChanged || !isAdmin || saving}>
            {saving ? '保存中...' : '保存品牌设置'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <SettingRow
          title="文字 LOGO"
          description="显示在页面顶部的品牌名称，最多 40 个字符"
          align="start"
        >
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Input
              id="brandText"
              maxLength={40}
              value={brandTextDraft}
              placeholder="例如：AIChat 或公司名"
              onChange={(e) => setBrandTextDraft(e.target.value)}
              onCompositionStart={() => setIsIMEComposing(true)}
              onCompositionEnd={() => setIsIMEComposing(false)}
              className="w-full sm:w-[320px]"
              disabled={!isAdmin}
            />
          </div>
        </SettingRow>

        <SettingRow
          title="全局系统提示词"
          description="留空则不注入；会话未设置时自动继承（默认上限 12000 字符，可通过后端环境变量调整）"
          align="start"
        >
          <div className="w-full space-y-2">
            <Textarea
              value={chatSystemPromptDraft}
              onChange={(e) => setChatSystemPromptDraft(e.target.value)}
              placeholder="例如：你是一位专业助教，请使用简洁、结构化的回答。"
              rows={4}
              disabled={!isAdmin}
            />
            <p className="text-xs text-muted-foreground">
              {'生效顺序：会话 > 个人 > 全局；支持使用 {day time}（将替换为服务器当前时间）。三层均为空时默认提示词为“今天日期是{day time}”。'}
            </p>
          </div>
        </SettingRow>

        <SettingRow
          title="图片访问域名"
          description="用户上传图片的公开访问地址前缀（需包含协议）"
          align="start"
        >
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Input
              id="chatImageDomain"
              type="text"
              value={siteBaseDraft}
              onChange={(e) => setSiteBaseDraft(e.target.value)}
              placeholder="例如：https://chat.example.com"
              className="w-full sm:w-[320px]"
              disabled={!isAdmin}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={handleRefreshImageAttachments}
              disabled={!isAdmin}
            >刷新</Button>
          </div>
        </SettingRow>
      </div>
    </FeatureCard>
  )
}
