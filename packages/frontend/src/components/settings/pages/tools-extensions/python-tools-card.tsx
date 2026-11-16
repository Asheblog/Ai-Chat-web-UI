"use client"

import { useEffect, useState } from "react"
import { Terminal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SettingRow } from "@/components/settings/components/setting-row"
import { useToast } from "@/components/ui/use-toast"
import { FeatureCard } from "@/components/settings/components/feature-card"
import type { SystemSettings } from "@/types"
import { parseNumericInput } from "@/features/settings/shared"

export interface PythonToolsCardProps {
  settings: SystemSettings
  update: (payload: Partial<SystemSettings>) => Promise<void>
}

const agentIterationRange = { min: 0, max: 20 }

/**
 * Python 工具卡：主开关 + Agent 工具循环上限。
 *
 * 旧的超时 / stdout 截断 / 代码长度三个输入已删除——聊天侧 Python 执行统一走 workspace 沙箱，
 * 实际约束来自 `WORKSPACE_RUN_TIMEOUT_MS` 与 `WORKSPACE_READ_MAX_CHARS`，改这三个旧键不产生任何效果。
 *
 * 动态 Skill Runtime 开关不在本卡：它由能力扩展页的 Skill 段页头唯一持有。
 */
export function PythonToolsCard({ settings, update }: PythonToolsCardProps) {
  const { toast } = useToast()
  const [pythonEnabled, setPythonEnabled] = useState(false)
  const [maxToolIterations, setMaxToolIterations] = useState(4)
  const [saving, setSaving] = useState(false)

  const savedEnabled = Boolean(settings.pythonToolEnable ?? false)
  const savedIterations = Number(settings.agentMaxToolIterations ?? 4)

  useEffect(() => {
    setPythonEnabled(Boolean(settings.pythonToolEnable ?? false))
    setMaxToolIterations(Number(settings.agentMaxToolIterations ?? 4))
  }, [settings])

  const iterationValid =
    maxToolIterations >= agentIterationRange.min && maxToolIterations <= agentIterationRange.max

  const changed = pythonEnabled !== savedEnabled || maxToolIterations !== savedIterations
  const valid = iterationValid

  const save = async () => {
    if (!valid || saving) return

    setSaving(true)
    try {
      await update({
        pythonToolEnable: pythonEnabled,
        agentMaxToolIterations: Math.max(
          agentIterationRange.min,
          Math.min(agentIterationRange.max, Math.round(maxToolIterations)),
        ),
      })
      toast({ title: "Python 工具设置已保存" })
    } catch (error) {
      toast({
        title: "Python 工具设置保存失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <FeatureCard
      icon={Terminal}
      title="Python 工具"
      description="允许 AI 在受管工作区沙箱中执行 Python 代码"
      cardKey="extensions:python-tools"
      enabled={pythonEnabled}
      onEnabledChange={setPythonEnabled}
      more={
        <SettingRow
          title="Agent 工具循环上限（0 表示不限制）"
          description={`一次回答里允许的连续工具调用轮数（${agentIterationRange.min}-${agentIterationRange.max}），对全部内置工具生效，不限于 Python。`}
          htmlFor="agent-max-tool-iterations"
        >
          <Input
            id="agent-max-tool-iterations"
            type="text"
            inputMode="numeric"
            value={maxToolIterations}
            onChange={(event) =>
              setMaxToolIterations((prev) => parseNumericInput(event.target.value, prev))
            }
            className={iterationValid ? undefined : "border-destructive"}
          />
        </SettingRow>
      }
      footer={
        <div className="flex justify-end">
          <Button onClick={save} disabled={!changed || !valid || saving}>
            {saving ? "保存中..." : "保存 Python 工具设置"}
          </Button>
        </div>
      }
    >
      <p className="text-[13px] leading-relaxed text-ink-tertiary">
        {"仅支持工具调用的连接可用。Python 解释器由受管运行环境统一提供（/app/data/python-runtime/venv）；执行超时与输出长度由工作区层的 WORKSPACE_RUN_TIMEOUT_MS / WORKSPACE_READ_MAX_CHARS 控制，不在本页配置。"}
      </p>
      {maxToolIterations === 0 ? (
        <p className="text-xs leading-5 text-destructive">
          0 表示不限制循环轮数：模型可以持续调用工具直到自行结束，请确认上游有预算控制。
        </p>
      ) : null}
    </FeatureCard>
  )
}
