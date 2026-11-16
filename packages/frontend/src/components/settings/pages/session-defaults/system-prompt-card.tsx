"use client"

import { useCallback, useEffect, useState } from "react"
import { MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/use-toast"
import { useAuthStore } from "@/store/auth-store"
import { FeatureCard } from "@/components/settings/components/feature-card"
import { SettingRow } from "@/components/settings/components/setting-row"
import type { SystemSettings } from "@/types"

export interface SystemPromptCardProps {
  settings: SystemSettings
  update: (payload: Partial<SystemSettings>) => Promise<void>
}

/**
 * 全局系统提示词卡（原「品牌定制」里的提示词行）。
 *
 * 它属于对话与模型的默认配置，不是外观，所以随「连接与模型 → 会话默认配置」走。
 * 保存失败必须让调用方看见：store 会抛错，这里 toast 失败并保留当前输入。
 */
export function SystemPromptCard({ settings, update }: SystemPromptCardProps) {
  const { toast } = useToast()
  const { actorState, user } = useAuthStore((state) => ({
    actorState: state.actorState,
    user: state.user,
  }))
  const isAdmin = actorState === "authenticated" && user?.role === "ADMIN"
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)

  const initial = settings.chatSystemPrompt || ""

  const resetDraft = useCallback(() => {
    setDraft(settings.chatSystemPrompt || "")
  }, [settings])

  useEffect(() => {
    resetDraft()
  }, [resetDraft])

  const changed = draft !== initial

  const handleSave = async () => {
    if (!isAdmin || saving) return
    setSaving(true)
    try {
      await update({ chatSystemPrompt: draft })
      toast({ title: "已保存全局系统提示词" })
    } catch (error: any) {
      toast({
        title: "保存失败",
        description: error?.response?.data?.error || error?.message || "全局系统提示词未能保存",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <FeatureCard
      icon={MessageSquare}
      title="全局系统提示词"
      description="所有会话的基础提示词：会话 > 全局 > 内置默认；个人偏好独立追加"
      cardKey="session-defaults:prompt"
      footer={
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={!isAdmin || saving || !changed}>
            {saving ? "保存中..." : "保存提示词"}
          </Button>
        </div>
      }
    >
      <SettingRow
        title="默认提示词"
        htmlFor="chatSystemPrompt"
        layout="stacked"
        description="留空则不注入；会话未设置时自动继承（默认上限 12000 字符，可通过后端环境变量调整）"
        align="start"
      >
        {(descriptionId) => (
          <div className="w-full space-y-2">
            <Textarea
              id="chatSystemPrompt"
              aria-describedby={`${descriptionId} prompt-precedence`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="例如：你是一位专业助教，请使用简洁、结构化的回答。"
              rows={5}
              disabled={!isAdmin}
            />
            <p id="prompt-precedence" className="text-[13px] leading-relaxed text-muted-foreground">
              {
                "基础提示词：会话 > 全局 > 内置默认；个人偏好作为独立内容追加，不会顶掉这三层。支持 {day time}（将替换为服务器当前时间）。"
              }
            </p>
          </div>
        )}
      </SettingRow>
    </FeatureCard>
  )
}
