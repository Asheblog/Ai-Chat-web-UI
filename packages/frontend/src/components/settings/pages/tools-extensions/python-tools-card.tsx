"use client"

import { useEffect, useState } from "react"
import { Terminal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"
import { FeatureCard } from "@/components/settings/components/feature-card"
import type { SystemSettings } from "@/types"
import { parseNumericInput } from "@/features/settings/shared"

export interface PythonToolsCardProps {
  settings: SystemSettings
  update: (payload: Partial<SystemSettings>) => Promise<void>
}

const pythonTimeoutRange = { min: 1000, max: 60000 }
const pythonOutputRange = { min: 256, max: 20000 }
const agentIterationRange = { min: 0, max: 20 }

/**
 * Python 工具卡：主开关 + 超时/stdout 截断/代码长度 + 「更多参数」折叠
 * （动态 Skill Runtime 开关 + Agent 工具最大迭代次数）。共 6 个 settings key。
 */
export function PythonToolsCard({ settings, update }: PythonToolsCardProps) {
  const { toast } = useToast()
  const [pythonEnabled, setPythonEnabled] = useState(false)
  const [chatDynamicSkillRuntimeEnabled, setChatDynamicSkillRuntimeEnabled] = useState(false)
  const [pythonTimeout, setPythonTimeout] = useState(8000)
  const [pythonMaxOutput, setPythonMaxOutput] = useState(4000)
  const [pythonMaxSource, setPythonMaxSource] = useState(4000)
  const [maxToolIterations, setMaxToolIterations] = useState(4)

  useEffect(() => {
    setPythonEnabled(Boolean(settings.pythonToolEnable ?? false))
    setChatDynamicSkillRuntimeEnabled(Boolean(settings.chatDynamicSkillRuntimeEnabled ?? false))
    setPythonTimeout(Number(settings.pythonToolTimeoutMs ?? 8000))
    setPythonMaxOutput(Number(settings.pythonToolMaxOutputChars ?? 4000))
    setPythonMaxSource(Number(settings.pythonToolMaxSourceChars ?? 4000))
    setMaxToolIterations(Number(settings.agentMaxToolIterations ?? 4))
  }, [settings])

  const pythonTimeoutValid =
    pythonTimeout >= pythonTimeoutRange.min && pythonTimeout <= pythonTimeoutRange.max
  const pythonMaxOutputValid =
    pythonMaxOutput >= pythonOutputRange.min && pythonMaxOutput <= pythonOutputRange.max
  const pythonMaxSourceValid =
    pythonMaxSource >= pythonOutputRange.min && pythonMaxSource <= pythonOutputRange.max
  const agentIterationValid =
    maxToolIterations >= agentIterationRange.min && maxToolIterations <= agentIterationRange.max
  const defaultToolIterations = Number(settings.agentMaxToolIterations ?? 4)

  const changed =
    pythonEnabled !== Boolean(settings.pythonToolEnable ?? false) ||
    chatDynamicSkillRuntimeEnabled !==
      Boolean(settings.chatDynamicSkillRuntimeEnabled ?? false) ||
    pythonTimeout !== Number(settings.pythonToolTimeoutMs ?? 8000) ||
    pythonMaxOutput !== Number(settings.pythonToolMaxOutputChars ?? 4000) ||
    pythonMaxSource !== Number(settings.pythonToolMaxSourceChars ?? 4000) ||
    maxToolIterations !== Number(settings.agentMaxToolIterations ?? 4)

  const valid =
    pythonTimeoutValid && pythonMaxOutputValid && pythonMaxSourceValid && agentIterationValid

  const save = async () => {
    if (!valid) return

    await update({
      pythonToolEnable: pythonEnabled,
      chatDynamicSkillRuntimeEnabled,
      pythonToolTimeoutMs: Math.max(
        pythonTimeoutRange.min,
        Math.min(pythonTimeoutRange.max, Math.round(pythonTimeout)),
      ),
      pythonToolMaxOutputChars: Math.max(
        pythonOutputRange.min,
        Math.min(pythonOutputRange.max, Math.round(pythonMaxOutput)),
      ),
      pythonToolMaxSourceChars: Math.max(
        pythonOutputRange.min,
        Math.min(pythonOutputRange.max, Math.round(pythonMaxSource)),
      ),
      agentMaxToolIterations: Math.max(
        agentIterationRange.min,
        Math.min(agentIterationRange.max, Math.round(maxToolIterations)),
      ),
    })
    toast({ title: "Python 工具设置已保存" })
  }

  return (
    <FeatureCard
      icon={Terminal}
      title="Python 工具"
      description="允许 AI 在本地沙箱中执行 Python 代码"
      cardKey="tools-extensions:python-tools"
      enabled={pythonEnabled}
      onEnabledChange={setPythonEnabled}
      more={
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-300/70 bg-amber-50/50 px-3 py-2 dark:border-amber-500/40 dark:bg-amber-950/30">
            <div>
              <p className="text-sm font-medium">启用聊天侧第三方动态 Skill Runtime</p>
              <p className="text-xs text-muted-foreground">
                默认关闭。开启后，聊天可直接调度已安装并绑定的第三方 Skill；建议配合审批与审计策略。
              </p>
            </div>
            <Switch
              checked={chatDynamicSkillRuntimeEnabled}
              onCheckedChange={(v) => setChatDynamicSkillRuntimeEnabled(!!v)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Agent 工具最大迭代次数（0 表示无限制）</label>
            <Input
              type="text"
              value={maxToolIterations}
              onChange={(e) => setMaxToolIterations((prev) => parseNumericInput(e.target.value, prev))}
              className={!agentIterationValid ? "border-destructive" : undefined}
            />
            <p className="text-xs text-muted-foreground">
              当前默认值：{defaultToolIterations}；范围 {agentIterationRange.min}-{agentIterationRange.max}，0 表示允许模型无限次调用工具。
            </p>
          </div>
        </div>
      }
      footer={
        <div className="flex justify-end">
          <Button onClick={save} disabled={!changed || !valid}>
            保存 Python 工具设置
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          仅 OpenAI / Azure OpenAI 等支持工具调用的连接可用。
        </p>
        <p className="text-xs text-muted-foreground">
          Python 解释器由受管运行环境统一提供（`/app/data/python-runtime/venv`），不再支持在此处自定义命令参数。
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">超时时间（毫秒）</label>
            <Input
              type="text"
              value={pythonTimeout}
              onChange={(e) => setPythonTimeout((prev) => parseNumericInput(e.target.value, prev))}
              className={!pythonTimeoutValid ? "border-destructive" : undefined}
            />
            <p className="text-xs text-muted-foreground">
              {pythonTimeoutRange.min} - {pythonTimeoutRange.max}，默认 8000。
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">stdout 截断字符数</label>
            <Input
              type="text"
              value={pythonMaxOutput}
              onChange={(e) => setPythonMaxOutput((prev) => parseNumericInput(e.target.value, prev))}
              className={!pythonMaxOutputValid ? "border-destructive" : undefined}
            />
            <p className="text-xs text-muted-foreground">
              {pythonOutputRange.min} - {pythonOutputRange.max}，默认 4000。
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">代码长度限制</label>
            <Input
              type="text"
              value={pythonMaxSource}
              onChange={(e) => setPythonMaxSource((prev) => parseNumericInput(e.target.value, prev))}
              className={!pythonMaxSourceValid ? "border-destructive" : undefined}
            />
            <p className="text-xs text-muted-foreground">
              {pythonOutputRange.min} - {pythonOutputRange.max}，默认 4000。
            </p>
          </div>
        </div>
      </div>
    </FeatureCard>
  )
}
