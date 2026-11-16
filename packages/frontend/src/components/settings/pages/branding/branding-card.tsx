"use client"

import { useEffect, useState } from "react"
import { Type } from "lucide-react"
import { isValidBrandHex } from "@aichat/shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
    description: "按钮、链接与强调色；留空使用默认暖橙",
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
 * 品牌与站点卡：主层只有网站名称与公开访问地址；
 * 6 个主题色 Token 收进「主题配色」折叠区——它们属于设计系统覆盖，不是日常配置，
 * 而且部分颜色只对浅色主题生效，混在名称旁边会让人以为改了就整体换肤。
 *
 * 保存失败必须可见：store 抛错 → toast 失败并保留草稿，只有成功才提示已保存。
 */
export function BrandingCard({ settings, update }: BrandingCardProps) {
  const { toast } = useToast()
  const { actorState, user } = useAuthStore((state) => ({
    actorState: state.actorState,
    user: state.user,
  }))
  const isAdmin = actorState === "authenticated" && user?.role === "ADMIN"
  const [brandTextDraft, setBrandTextDraft] = useState("")
  const [siteBaseDraft, setSiteBaseDraft] = useState("")
  const [colorDrafts, setColorDrafts] = useState<Record<BrandColorField, string>>({
    brandPrimary: "",
    brandPrimaryForeground: "",
    brandBackground: "",
    brandSurface: "",
    brandForeground: "",
    brandMutedForeground: "",
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setBrandTextDraft(settings.brandText || "")
    setSiteBaseDraft(settings.siteBaseUrl || "")
    setColorDrafts({
      brandPrimary: readBrandColor(settings, "brandPrimary"),
      brandPrimaryForeground: readBrandColor(settings, "brandPrimaryForeground"),
      brandBackground: readBrandColor(settings, "brandBackground"),
      brandSurface: readBrandColor(settings, "brandSurface"),
      brandForeground: readBrandColor(settings, "brandForeground"),
      brandMutedForeground: readBrandColor(settings, "brandMutedForeground"),
    })
  }, [settings])

  const initialSiteBase = (settings.siteBaseUrl || "").trim()
  const initialColors: Record<BrandColorField, string> = {
    brandPrimary: readBrandColor(settings, "brandPrimary"),
    brandPrimaryForeground: readBrandColor(settings, "brandPrimaryForeground"),
    brandBackground: readBrandColor(settings, "brandBackground"),
    brandSurface: readBrandColor(settings, "brandSurface"),
    brandForeground: readBrandColor(settings, "brandForeground"),
    brandMutedForeground: readBrandColor(settings, "brandMutedForeground"),
  }

  const colorsChanged = BRAND_COLOR_FIELDS.some(
    ({ key }) => normalizeHexDraft(colorDrafts[key]) !== initialColors[key],
  )

  const fieldChanged =
    brandTextDraft !== (settings.brandText || '') ||
    siteBaseDraft.trim() !== initialSiteBase ||
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
        siteBaseUrl: siteBaseDraft.trim(),
      }
      for (const { key } of BRAND_COLOR_FIELDS) {
        const draft = normalizeHexDraft(colorDrafts[key])
        payload[key] = draft && isValidBrandHex(draft) ? draft : ""
      }
      await update(payload)
      toast({ title: '已保存品牌设置' })
    } catch (error: any) {
      toast({
        title: '保存失败',
        description: error?.response?.data?.error || error?.message || '品牌设置未能保存',
        variant: 'destructive',
      })
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
      title="品牌与站点"
      description="站点名称、公开访问地址与主题配色"
      cardKey="branding:branding"
      moreLabel="主题配色"
      more={
        <>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            留空恢复默认色；部分颜色仅对浅色主题生效，深色主题沿用自身对比度规则。
          </p>
          {BRAND_COLOR_FIELDS.map(({ key, title, description, previewFallback }) => {
            const draft = colorDrafts[key]
            const normalized = normalizeHexDraft(draft)
            const pickerValue = isValidBrandHex(normalized) ? normalized : previewFallback
            return (
              <SettingRow key={key} title={title} description={description} htmlFor={key}>
                {(descriptionId) => (
                  <div className="flex w-full flex-wrap items-center justify-end gap-2">
                    <Input
                      aria-describedby={descriptionId}
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
                      className="min-w-0 flex-1 font-mono sm:w-[140px] sm:flex-none"
                      disabled={!isAdmin}
                      aria-label={`${title}十六进制`}
                      aria-describedby={descriptionId}
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
                )}
              </SettingRow>
            )
          })}
        </>
      }
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button onClick={handleSave} disabled={!fieldChanged || !isAdmin || saving}>
            {saving ? '保存中...' : '保存品牌设置'}
          </Button>
        </div>
      }
    >
      <SettingRow
        title="品牌名"
        htmlFor="brandText"
        description="显示在页面顶部的站点名称，最多 40 个字符"
      >
        {(descriptionId) => (
          <Input
            aria-describedby={descriptionId}
            id="brandText"
            maxLength={40}
            value={brandTextDraft}
            placeholder="例如：AIChat 或公司名"
            onChange={(e) => setBrandTextDraft(e.target.value)}
            className="w-full sm:w-[320px]"
            disabled={!isAdmin}
          />
        )}
      </SettingRow>

      <SettingRow
        title="图片访问域名"
        htmlFor="chatImageDomain"
        layout="stacked"
        description="用户上传图片的公开访问地址前缀（需包含协议）"
        align="start"
      >
        {(descriptionId) => (
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Input
              aria-describedby={descriptionId}
              id="chatImageDomain"
              type="text"
              value={siteBaseDraft}
              onChange={(e) => setSiteBaseDraft(e.target.value)}
              placeholder="例如：https://chat.example.com"
              className="min-w-0 flex-1"
              disabled={!isAdmin}
            />
            <Button size="sm" variant="secondary" onClick={handleRefreshImageAttachments} disabled={!isAdmin}>
              刷新
            </Button>
          </div>
        )}
      </SettingRow>
    </FeatureCard>
  )
}
