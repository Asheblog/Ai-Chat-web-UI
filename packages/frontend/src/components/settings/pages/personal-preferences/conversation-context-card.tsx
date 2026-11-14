"use client"

import { useEffect, useState } from "react"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { DEFAULT_MAX_SYSTEM_PROMPT_LENGTH } from "@aichat/shared/api-contract"
import { useAuthStore } from "@/store/auth-store"
import { useToast } from "@/components/ui/use-toast"
import { getAppInfo, updatePersonalSettings } from '@/features/settings/api'
import { SettingRow } from "../../components/setting-row"
import { SETTINGS_CARD, SETTINGS_CARD_BODY, SETTINGS_CARD_DESCRIPTION, SETTINGS_CARD_HEADER, SETTINGS_CARD_TITLE } from "../../components/settings-surfaces"

/**
 * 个人设置 · 「对话与上下文」卡片：状态与副作用从 PersonalPreferences 抽出（原文件已越过 lint 行数上限）。
 * 数据与交互沿用原实现；文案按 ADR-0040 重述真实作用域，并补了 `aria-label`——不要把旧文案当作基线。
 */
export function ConversationContextCard() {
  const { toast } = useToast()
  const { user, fetchActor } = useAuthStore((state) => ({ user: state.user, fetchActor: state.fetchActor }))
  const [personalPromptDraft, setPersonalPromptDraft] = useState(user?.personalPrompt ?? "")
  const [personalPromptSaving, setPersonalPromptSaving] = useState(false)
  const [personalPromptError, setPersonalPromptError] = useState<string | null>(null)
  const [contextEnabledSaving, setContextEnabledSaving] = useState(false)
  const [contextEnabledOptimistic, setContextEnabledOptimistic] = useState<boolean | null>(null)
  const [promptMaxLength, setPromptMaxLength] = useState(DEFAULT_MAX_SYSTEM_PROMPT_LENGTH)

  // 上下文开关是账号偏好：本地只在请求飞行中做乐观显示，服务端回填后立刻回归真值。
  const resolvedContextEnabled = user?.contextEnabled ?? true
  const contextEnabled = contextEnabledOptimistic ?? resolvedContextEnabled

  useEffect(() => {
    setContextEnabledOptimistic(null)
  }, [resolvedContextEnabled])

  // 提示词上限只有 app-info 一个事实源；取不到就留在 shared 默认常量上。
  useEffect(() => {
    let cancelled = false
    getAppInfo()
      .then((info) => {
        const limit = info?.limits?.system_prompt_max_length
        if (!cancelled && typeof limit === "number" && limit > 0) setPromptMaxLength(limit)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    setPersonalPromptDraft(user?.personalPrompt ?? "")
  }, [user?.personalPrompt])

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

  const handleContextEnabledChange = async (next: boolean) => {
    if (!user || contextEnabledSaving) return
    const previous = contextEnabled
    setContextEnabledOptimistic(next)
    setContextEnabledSaving(true)
    try {
      await updatePersonalSettings({ contextEnabled: next })
      await fetchActor()
      toast({ title: next ? '已开启对话上下文' : '已关闭对话上下文' })
    } catch (error: any) {
      setContextEnabledOptimistic(previous)
      const description = error?.response?.data?.error || error?.message || '更新对话上下文设置失败'
      toast({ title: '更新失败', description, variant: 'destructive' })
    } finally {
      setContextEnabledSaving(false)
    }
  }

  return (
    <section className={SETTINGS_CARD}>
      <div className={SETTINGS_CARD_HEADER}>
        <div className="min-w-0">
          <h2 className={SETTINGS_CARD_TITLE}>对话与上下文</h2>
          <p className={SETTINGS_CARD_DESCRIPTION}>设置 AI 是否参考本会话历史，以及你的个人提示词</p>
        </div>
      </div>
      <div className={SETTINGS_CARD_BODY + " space-y-4"}>
        <SettingRow
          title="记住对话上下文"
          description={
            contextEnabled
              ? '把本会话的历史消息一并发送给 AI（不含其他会话）'
              : '只发送当前这条消息；历史仍会保存，重新开启后可继续'
          }
        >
          <Switch
            aria-label="记住对话上下文"
            checked={contextEnabled}
            onCheckedChange={handleContextEnabledChange}
            disabled={!user || contextEnabledSaving}
          />
        </SettingRow>
        <SettingRow
          title="个人系统提示词"
          description="会追加在全局提示词之后；会话自定义提示词优先级最高"
          align="start"
        >
          <Textarea
            value={personalPromptDraft}
            onChange={(event) => {
              setPersonalPromptDraft(event.target.value)
              if (personalPromptError) {
                setPersonalPromptError(null)
              }
            }}
            onBlur={() => handlePersonalPromptSave()}
            maxLength={promptMaxLength}
            placeholder="你是一个专业、友善且高效的 AI 助手。"
            aria-label="个人系统提示词"
            className="min-h-[82px] resize-none text-[13px]"
            disabled={!user || personalPromptSaving}
          />
          {personalPromptError && <p className="mt-1.5 text-[11.5px] text-destructive">{personalPromptError}</p>}
          <p className="num-tabular mt-1 text-right text-[11px] text-ink-tertiary">
            {personalPromptDraft.length}/{promptMaxLength}
          </p>
        </SettingRow>
      </div>
    </section>
  )
}
