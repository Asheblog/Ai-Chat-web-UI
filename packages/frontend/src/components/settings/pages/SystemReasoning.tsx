"use client"
import { useEffect, useState } from "react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CardTitle, CardDescription } from "@/components/ui/card"
import { useSystemSettings } from "@/hooks/use-system-settings"
import { Brain } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { SettingRow } from "../components/setting-row"

export function SystemReasoningPage() {
  const {
    settings: systemSettings,
    refresh: fetchSystemSettings,
    update: updateSystemSettings,
    isLoading,
  } = useSystemSettings()
  const { toast } = useToast()

  const [reasoningEnabled, setReasoningEnabled] = useState(true)
  const [reasoningDefaultExpand, setReasoningDefaultExpand] = useState(false)
  const [reasoningSaveToDb, setReasoningSaveToDb] = useState(true)
  const [reasoningTagsMode, setReasoningTagsMode] = useState<'default'|'custom'|'off'>('default')
  const [reasoningCustomTags, setReasoningCustomTags] = useState('')
  const [streamDeltaChunkSize, setStreamDeltaChunkSize] = useState(1)
  const [streamDeltaFlushIntervalMs, setStreamDeltaFlushIntervalMs] = useState('')
  const [streamReasoningFlushIntervalMs, setStreamReasoningFlushIntervalMs] = useState('')
  const [streamKeepaliveIntervalMs, setStreamKeepaliveIntervalMs] = useState('')
  const [openaiReasoningEffort, setOpenaiReasoningEffort] = useState<'unset'|'low'|'medium'|'high'>('unset')
  const [ollamaThink, setOllamaThink] = useState(false)
  const [reasoningMaxTokens, setReasoningMaxTokens] = useState('')

  useEffect(()=>{ fetchSystemSettings() }, [fetchSystemSettings])
  useEffect(()=>{
    if (!systemSettings) return
    setReasoningEnabled(Boolean(systemSettings.reasoningEnabled ?? true))
    setReasoningDefaultExpand(Boolean(systemSettings.reasoningDefaultExpand ?? false))
    setReasoningSaveToDb(Boolean(systemSettings.reasoningSaveToDb ?? true))
    setReasoningTagsMode((systemSettings.reasoningTagsMode as any) || 'default')
    setReasoningCustomTags(systemSettings.reasoningCustomTags || '')
    setStreamDeltaChunkSize(Number(systemSettings.streamDeltaChunkSize ?? 1))
    setStreamDeltaFlushIntervalMs(
      systemSettings.streamDeltaFlushIntervalMs != null ? String(systemSettings.streamDeltaFlushIntervalMs) : ''
    )
    setStreamReasoningFlushIntervalMs(
      systemSettings.streamReasoningFlushIntervalMs != null ? String(systemSettings.streamReasoningFlushIntervalMs) : ''
    )
    setStreamKeepaliveIntervalMs(
      systemSettings.streamKeepaliveIntervalMs != null ? String(systemSettings.streamKeepaliveIntervalMs) : ''
    )
    setOpenaiReasoningEffort((((systemSettings as any).openaiReasoningEffort || 'unset')) as any)
    setOllamaThink(Boolean((systemSettings as any).ollamaThink ?? false))
    const sysMaxTokens = systemSettings?.reasoningMaxOutputTokensDefault
    setReasoningMaxTokens(typeof sysMaxTokens === 'number' ? String(sysMaxTokens) : '')
  }, [systemSettings])

  const handleSave = async () => {
    if (reasoningTagsMode === 'custom') {
      try {
        const arr = JSON.parse(reasoningCustomTags)
        if (!Array.isArray(arr) || arr.length !== 2 || typeof arr[0] !== 'string' || typeof arr[1] !== 'string') {
          throw new Error('自定义标签需为 [startTag, endTag]')
        }
      } catch (e) {
        toast({
          title: '自定义标签无效',
          description: '格式必须为 ["<think>","</think>"] 这样的 JSON 数组。',
          variant: 'destructive',
        })
        return
      }
    }
    const parseInterval = (raw: string, label: string) => {
      const trimmed = raw.trim()
      if (trimmed === '') return 0
      const parsed = Number.parseInt(trimmed, 10)
      if (!Number.isFinite(parsed) || parsed < 0) {
        toast({
          title: `${label}无效`,
          description: '请输入大于等于 0 的整数',
          variant: 'destructive',
        })
        throw new Error('invalid')
      }
      return parsed
    }
    let deltaFlushMs: number
    let reasoningFlushMs: number
    let keepaliveMs: number
    try {
      deltaFlushMs = parseInterval(streamDeltaFlushIntervalMs, '正文 flush 间隔')
      reasoningFlushMs = parseInterval(streamReasoningFlushIntervalMs, '推理 flush 间隔')
      keepaliveMs = parseInterval(streamKeepaliveIntervalMs, 'Keepalive 间隔')
    } catch {
      return
    }
    let maxTokensValue: number | null
    const trimmedMaxTokens = reasoningMaxTokens.trim()
    if (trimmedMaxTokens === '') {
      maxTokensValue = null
    } else {
      const parsed = Number.parseInt(trimmedMaxTokens, 10)
      if (!Number.isFinite(parsed) || parsed < 1) {
        toast({
          title: '默认生成 Tokens 无效',
          description: '请输入 1~256000 的整数，或留空表示使用默认值（32K）',
          variant: 'destructive',
        })
        return
      }
      maxTokensValue = Math.min(256000, parsed)
    }

    await updateSystemSettings({
      reasoningEnabled,
      reasoningDefaultExpand,
      reasoningSaveToDb,
      reasoningTagsMode,
      reasoningCustomTags,
      streamDeltaChunkSize,
      streamDeltaFlushIntervalMs: deltaFlushMs,
      streamReasoningFlushIntervalMs: reasoningFlushMs,
      streamKeepaliveIntervalMs: keepaliveMs,
      openaiReasoningEffort: openaiReasoningEffort !== 'unset' ? openaiReasoningEffort : 'unset',
      reasoningMaxOutputTokensDefault: maxTokensValue,
      ollamaThink,
    } as any)
    toast({ title: '已保存推理链设置' })
  }

  if (!systemSettings) return null

  return (
    <div className="space-y-6">

      {/* 推理链配置区块 */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b">
          <Brain className="w-5 h-5 text-primary" />
          <div>
            <CardTitle className="text-lg font-semibold tracking-tight">推理链配置</CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              控制思维过程的识别、展示和存储
            </CardDescription>
          </div>
        </div>
        <SettingRow
          title="启用推理链"
          description="识别 reasoning_content 与常见 CoT 标签，并在 UI 折叠显示"
        >
          <Switch id="reasoningEnabled" checked={reasoningEnabled} onCheckedChange={(v)=>setReasoningEnabled(!!v)} />
        </SettingRow>

        <SettingRow
          title="默认展开"
          description="仅影响默认展示，用户可手动折叠/展开"
        >
          <Switch id="reasoningDefaultExpand" checked={reasoningDefaultExpand} onCheckedChange={(v)=>setReasoningDefaultExpand(!!v)} />
        </SettingRow>

        <SettingRow
          title="保存到数据库"
          description="可能包含中间推断过程，请按需开启"
        >
          <Switch id="reasoningSaveToDb" checked={reasoningSaveToDb} onCheckedChange={(v)=>setReasoningSaveToDb(!!v)} />
        </SettingRow>

        <SettingRow
          title="默认生成 Tokens"
          description="为空表示沿用供应商默认（通常 32K），可根据模型能力设置 1~256000"
        >
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
            <Input
              type="number"
              min={1}
              max={256000}
              placeholder="32000"
              value={reasoningMaxTokens}
              onChange={(e)=>setReasoningMaxTokens(e.target.value)}
              className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 w-full sm:w-32 text-right"
            />
            <Button
              variant="outline"
              size="sm"
              className="w-full sm:w-auto"
              onClick={()=>setReasoningMaxTokens('')}
            >
              恢复默认
            </Button>
          </div>
        </SettingRow>

        <SettingRow
          title="标签模式"
          description="默认包含 <think> / <|begin_of_thought|> 等常见标签"
          align="start"
        >
          <div className="flex w-full flex-wrap items-center justify-end gap-3">
            <Select value={reasoningTagsMode} onValueChange={(v)=>setReasoningTagsMode(v as any)}>
              <SelectTrigger className="w-full sm:w-[220px]"><SelectValue placeholder="选择模式" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="default">默认</SelectItem>
                <SelectItem value="custom">自定义</SelectItem>
                <SelectItem value="off">关闭</SelectItem>
              </SelectContent>
            </Select>
            {reasoningTagsMode === 'custom' && (
              <Input placeholder='["<think>","</think>"]' value={reasoningCustomTags} onChange={(e)=>setReasoningCustomTags(e.target.value)} className="w-full sm:w-[320px] font-mono text-xs" />
            )}
          </div>
        </SettingRow>

        <SettingRow
          title="流式增量聚合（分片大小）"
          description="越大则刷新更平滑但延迟稍增（范围 1-100）"
        >
          <Input id="deltaSize" type="number" min={1} max={100} value={streamDeltaChunkSize} onChange={(e)=>setStreamDeltaChunkSize(Number(e.target.value||1))} className="w-full sm:w-32 text-right" />
        </SettingRow>

        <SettingRow
          title="正文 flush 间隔（毫秒）"
          description="推荐 800ms；0 表示仅按分片大小触发（范围 0-3600000 ms）"
        >
          <Input
            type="number"
            min={0}
            placeholder="800"
            value={streamDeltaFlushIntervalMs}
            onChange={(e)=>setStreamDeltaFlushIntervalMs(e.target.value)}
            className="w-full sm:w-32 text-right"
          />
        </SettingRow>

        <SettingRow
          title="推理 flush 间隔（毫秒）"
          description="推荐 1000ms；0 表示仅当标签闭合时推送（范围 0-3600000 ms）"
        >
          <Input
            type="number"
            min={0}
            placeholder="1000"
            value={streamReasoningFlushIntervalMs}
            onChange={(e)=>setStreamReasoningFlushIntervalMs(e.target.value)}
            className="w-full sm:w-32 text-right"
          />
        </SettingRow>

        <SettingRow
          title="Keepalive 间隔（毫秒）"
          description="推荐 5000ms；0 表示仅在推理 keepalive 触发（范围 0-3600000 ms）"
        >
          <Input
            type="number"
            min={0}
            placeholder="5000"
            value={streamKeepaliveIntervalMs}
            onChange={(e)=>setStreamKeepaliveIntervalMs(e.target.value)}
            className="w-full sm:w-32 text-right"
          />
        </SettingRow>

        <SettingRow
          title="OpenAI reasoning_effort"
          description="仅对支持该参数的模型生效"
        >
          <Select value={openaiReasoningEffort} onValueChange={(v)=>setOpenaiReasoningEffort(v as any)}>
            <SelectTrigger className="w-full sm:w-[220px]"><SelectValue placeholder="不设置" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unset">不设置</SelectItem>
              <SelectItem value="low">low</SelectItem>
              <SelectItem value="medium">medium</SelectItem>
              <SelectItem value="high">high</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>

        <SettingRow
          title="Ollama think"
          description="上游为 Ollama 时按需启用"
        >
          <Switch id="ollamaThink" checked={ollamaThink} onCheckedChange={(v)=>setOllamaThink(!!v)} />
        </SettingRow>

        <div className="flex justify-end pt-4">
          <Button onClick={handleSave} disabled={isLoading}>保存设置</Button>
        </div>
      </div>
    </div>
  )
}
