"use client"

import { useCallback, useEffect, useState } from "react"
import { Type } from "lucide-react"
import { isValidBrandHex } from "@aichat/shared"
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

type BrandColorField =
  | "brandPrimary"
  | "brandPrimaryForeground"
  | "brandBackground"
  | "brandSurface"
  | "brandForeground"
  | "brandMutedForeground"

const BRAND_COLOR_FIELDS: Array<{
  key: BrandColorField
  title: string
  description: string
  previewFallback: string
}> = [
  {
    key: "brandPrimary",
    title: "主色",
    description: "按钮、链接与强调色；留空使用 Claude 默认暖橙",
    previewFallback: "#C96A3A",
  },
  {
    key: "brandPrimaryForeground",
    title: "主色前景",
    description: "主色按钮上的文字/图标色",
    previewFallback: "#FFFFFF",
  },
  {
    key: "brandBackground",
    title: "背景色",
    description: "页面纸感背景",
    previewFallback: "#F7F3EE",
  },
  {
    key: "brandSurface",
    title: "表面色",
    description: "卡片、弹层等表面容器",
    previewFallback: "#FCFAF7",
  },
  {
    key: "brandForeground",
    title: "前景色",
    description: "主要正文文字色",
    previewFallback: "#241C16",
  },
  {
    key: "brandMutedForeground",
    title: "次要前景",
    description: "辅助说明与弱化文字",
    previewFallback: "#6B5E54",
  },
]

const normalizeHexDraft = (value: string) => value.trim().toUpperCase()

const readBrandColor = (settings: SystemSettings, key: BrandColorField) =>
  (settings[key] || "").trim().toUpperCase()

/**
 * 品牌定制卡：文字 LOGO / 系统提示词 / 图片域名 + Brand Theme 六色覆盖，
 * draft/fieldChanged 模式；空字符串表示恢复默认主题色。
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
  const [colorDrafts, setColorDrafts] = useState<Record<BrandColorField, string>>({
    brandPrimary: "",
    brandPrimaryForeground: "",
    brandBackground: "",
    brandSurface: "",
    brandForeground: "",
    brandMutedForeground: "",
  })
  const [saving, setSaving] = useState(false)

  const resetDrafts = useCallback(() => {
    setBrandTextDraft(settings.brandText || '')
    setChatSystemPromptDraft(settings.chatSystemPrompt || '')
    setSiteBaseDraft(settings.siteBaseUrl || '')
    setColorDrafts({
      brandPrimary: readBrandColor(settings, "brandPrimary"),
      brandPrimaryForeground: readBrandColor(settings, "brandPrimaryForeground"),
      brandBackground: readBrandColor(settings, "brandBackground"),
      brandSurface: readBrandColor(settings, "brandSurface"),
      brandForeground: readBrandColor(settings, "brandForeground"),
      brandMutedForeground: readBrandColor(settings, "brandMutedForeground"),
    })
  }, [settings])

  useEffect(() => {
    resetDrafts()
  }, [resetDrafts])

  const normalizedInitials = {
    brandText: settings.brandText || '',
    chatSystemPrompt: settings.chatSystemPrompt || '',
    siteBaseUrl: (settings.siteBaseUrl || '').trim(),
    colors: {
      brandPrimary: readBrandColor(settings, "brandPrimary"),
      brandPrimaryForeground: readBrandColor(settings, "brandPrimaryForeground"),
      brandBackground: readBrandColor(settings, "brandBackground"),
      brandSurface: readBrandColor(settings, "brandSurface"),
      brandForeground: readBrandColor(settings, "brandForeground"),
      brandMutedForeground: readBrandColor(settings, "brandMutedForeground"),
    },
  }

  const colorsChanged = BRAND_COLOR_FIELDS.some(
    ({ key }) => normalizeHexDraft(colorDrafts[key]) !== normalizedInitials.colors[key],
  )

  const fieldChanged =
    brandTextDraft !== normalizedInitials.brandText ||
    chatSystemPromptDraft !== normalizedInitials.chatSystemPrompt ||
    siteBaseDraft.trim() !== normalizedInitials.siteBaseUrl ||
    colorsChanged

  const setColorDraft = (key: BrandColorField, value: string) => {
    setColorDrafts((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = async () => {
    if (!isAdmin || saving) return
    for (const { key, title } of BRAND_COLOR_FIELDS) {
      const draft = normalizeHexDraft(colorDrafts[key])
      if (draft && !isValidBrandHex(draft)) {
        toast({
          title: "颜色格式无效",
          description: `${title} 需为 #RRGGBB，或留空恢复默认`,
          variant: "destructive",
        })
        return
      }
    }
    setSaving(true)
    try {
      const payload: Partial<SystemSettings> = {
        brandText: brandTextDraft,
        chatSystemPrompt: chatSystemPromptDraft,
        siteBaseUrl: siteBaseDraft.trim(),
      }
      for (const { key } of BRAND_COLOR_FIELDS) {
        const draft = normalizeHexDraft(colorDrafts[key])
        payload[key] = draft && isValidBrandHex(draft) ? draft : ""
      }
      await update(payload)
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

        {BRAND_COLOR_FIELDS.map(({ key, title, description, previewFallback }) => {
          const draft = colorDrafts[key]
          const normalized = normalizeHexDraft(draft)
          const pickerValue = isValidBrandHex(normalized) ? normalized : previewFallback
          return (
            <SettingRow key={key} title={title} description={description} align="start">
              <div className="flex w-full flex-wrap items-center justify-end gap-2">
                <Input
                  id={`${key}-picker`}
                  type="color"
                  aria-label={`${title}色板`}
                  value={pickerValue}
                  onChange={(e) => setColorDraft(key, e.target.value.toUpperCase())}
                  className="h-10 w-14 cursor-pointer p-1"
                  disabled={!isAdmin}
                />
                <Input
                  id={key}
                  type="text"
                  value={draft}
                  onChange={(e) => setColorDraft(key, e.target.value)}
                  placeholder="#RRGGBB"
                  spellCheck={false}
                  className="w-full font-mono sm:w-[140px]"
                  disabled={!isAdmin}
                  aria-label={`${title}十六进制`}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setColorDraft(key, "")}
                  disabled={!isAdmin || !draft}
                >
                  恢复默认
                </Button>
              </div>
            </SettingRow>
          )
        })}
      </div>
    </FeatureCard>
  )
}
