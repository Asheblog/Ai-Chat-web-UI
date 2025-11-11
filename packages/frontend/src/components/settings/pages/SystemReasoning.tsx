"use client"
import { useEffect, useState } from "react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardTitle, CardDescription } from "@/components/ui/card"
import { useSystemSettings } from "@/hooks/use-system-settings"
import { Brain } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"

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
  const [openaiReasoningEffort, setOpenaiReasoningEffort] = useState<'unset'|'low'|'medium'|'high'>('unset')
  const [ollamaThink, setOllamaThink] = useState(false)

  useEffect(()=>{ fetchSystemSettings() }, [fetchSystemSettings])
  useEffect(()=>{
    if (!systemSettings) return
    setReasoningEnabled(Boolean(systemSettings.reasoningEnabled ?? true))
    setReasoningDefaultExpand(Boolean(systemSettings.reasoningDefaultExpand ?? false))
    setReasoningSaveToDb(Boolean(systemSettings.reasoningSaveToDb ?? true))
    setReasoningTagsMode((systemSettings.reasoningTagsMode as any) || 'default')
    setReasoningCustomTags(systemSettings.reasoningCustomTags || '')
    setStreamDeltaChunkSize(Number(systemSettings.streamDeltaChunkSize ?? 1))
    setOpenaiReasoningEffort((((systemSettings as any).openaiReasoningEffort || 'unset')) as any)
    setOllamaThink(Boolean((systemSettings as any).ollamaThink ?? false))
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
    await updateSystemSettings({
      reasoningEnabled,
      reasoningDefaultExpand,
      reasoningSaveToDb,
      reasoningTagsMode,
      reasoningCustomTags,
      streamDeltaChunkSize,
      openaiReasoningEffort: openaiReasoningEffort !== 'unset' ? openaiReasoningEffort : 'unset',
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
            <CardTitle className="text-lg">推理链配置</CardTitle>
            <CardDescription>控制思维过程的识别、展示和存储</CardDescription>
          </div>
        </div>
        <Card className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-6 px-4 py-4 sm:px-5 sm:py-5 transition-all hover:border-primary/30 hover:shadow-sm">
          <div className="flex-1">
            <CardTitle className="text-lg">启用推理链</CardTitle>
            <CardDescription>识别 reasoning_content 与常见 CoT 标签，并在 UI 折叠显示</CardDescription>
          </div>
          <div className="shrink-0 self-start sm:self-auto">
            <Switch id="reasoningEnabled" checked={reasoningEnabled} onCheckedChange={(v)=>setReasoningEnabled(!!v)} />
          </div>
        </Card>

        <Card className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-6 px-4 py-4 sm:px-5 sm:py-5 transition-all hover:border-primary/30 hover:shadow-sm">
          <div className="flex-1">
            <CardTitle className="text-lg">默认展开</CardTitle>
            <CardDescription>仅影响默认展示，用户可手动折叠/展开</CardDescription>
          </div>
          <div className="shrink-0 self-start sm:self-auto">
            <Switch id="reasoningDefaultExpand" checked={reasoningDefaultExpand} onCheckedChange={(v)=>setReasoningDefaultExpand(!!v)} />
          </div>
        </Card>

        <Card className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-6 px-4 py-4 sm:px-5 sm:py-5 transition-all hover:border-primary/30 hover:shadow-sm">
          <div className="flex-1">
            <CardTitle className="text-lg">保存到数据库</CardTitle>
            <CardDescription>可能包含中间推断过程，请按需开启</CardDescription>
          </div>
          <div className="shrink-0 self-start sm:self-auto">
            <Switch id="reasoningSaveToDb" checked={reasoningSaveToDb} onCheckedChange={(v)=>setReasoningSaveToDb(!!v)} />
          </div>
        </Card>

        <Card className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-6 px-4 py-4 sm:px-5 sm:py-5 transition-all hover:border-primary/30 hover:shadow-sm">
          <div className="flex-1">
            <CardTitle className="text-lg">标签模式</CardTitle>
            <CardDescription>默认包含 &lt;think&gt; / &lt;|begin_of_thought|&gt; 等常见标签</CardDescription>
          </div>
          <div className="shrink-0 self-start sm:self-auto flex items-center gap-2">
            <Select value={reasoningTagsMode} onValueChange={(v)=>setReasoningTagsMode(v as any)}>
              <SelectTrigger className="w-36"><SelectValue placeholder="选择模式" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="default">默认</SelectItem>
                <SelectItem value="custom">自定义</SelectItem>
                <SelectItem value="off">关闭</SelectItem>
              </SelectContent>
            </Select>
            {reasoningTagsMode === 'custom' && (
              <Input placeholder='["<think>","</think>"]' value={reasoningCustomTags} onChange={(e)=>setReasoningCustomTags(e.target.value)} className="w-64 font-mono text-xs" />
            )}
          </div>
        </Card>

        <Card className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-6 px-4 py-4 sm:px-5 sm:py-5 transition-all hover:border-primary/30 hover:shadow-sm">
          <div className="flex-1">
            <CardTitle className="text-lg">流式增量聚合（分片大小）</CardTitle>
            <CardDescription>越大则刷新更平滑但延迟稍增</CardDescription>
          </div>
          <div className="shrink-0 self-start sm:self-auto">
            <Input id="deltaSize" type="number" min={1} max={100} value={streamDeltaChunkSize} onChange={(e)=>setStreamDeltaChunkSize(Number(e.target.value||1))} className="w-24 text-right" />
          </div>
        </Card>

        <Card className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-6 px-4 py-4 sm:px-5 sm:py-5 transition-all hover:border-primary/30 hover:shadow-sm">
          <div className="flex-1">
            <CardTitle className="text-lg">OpenAI reasoning_effort</CardTitle>
            <CardDescription>仅对支持该参数的模型生效</CardDescription>
          </div>
          <div className="shrink-0 self-start sm:self-auto">
            <Select value={openaiReasoningEffort} onValueChange={(v)=>setOpenaiReasoningEffort(v as any)}>
              <SelectTrigger className="w-36"><SelectValue placeholder="不设置" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">不设置</SelectItem>
                <SelectItem value="low">low</SelectItem>
                <SelectItem value="medium">medium</SelectItem>
                <SelectItem value="high">high</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Card>

        <Card className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-6 px-4 py-4 sm:px-5 sm:py-5 transition-all hover:border-primary/30 hover:shadow-sm">
          <div className="flex-1">
            <CardTitle className="text-lg">Ollama think</CardTitle>
            <CardDescription>上游为 Ollama 时按需启用</CardDescription>
          </div>
          <div className="shrink-0 self-start sm:self-auto">
            <Switch id="ollamaThink" checked={ollamaThink} onCheckedChange={(v)=>setOllamaThink(!!v)} />
          </div>
        </Card>

        <div className="flex justify-end pt-4">
          <Button onClick={handleSave} disabled={isLoading}>保存设置</Button>
        </div>
      </div>
    </div>
  )
}
