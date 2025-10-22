"use client"
import { useEffect, useState } from "react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useSettingsStore } from "@/store/settings-store"

export function SystemReasoningPage() {
  const { systemSettings, fetchSystemSettings, updateSystemSettings, isLoading } = useSettingsStore()

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
    setOpenaiReasoningEffort((((systemSettings as any).openaiReasoningEffort ?? 'unset')) as any)
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
        alert('自定义标签无效，必须是形如 ["<think>","</think>"] 的 JSON')
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
      openaiReasoningEffort: openaiReasoningEffort !== 'unset' ? openaiReasoningEffort : undefined,
      ollamaThink,
    } as any)
  }

  if (!systemSettings) return null

  return (
    <div className="p-4 space-y-6">
      <div className="text-base font-medium">推理链（CoT）</div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="reasoningEnabled">启用推理链</Label>
            <p className="text-sm text-muted-foreground">识别 reasoning_content 与常见 CoT 标签，并在 UI 折叠显示。</p>
          </div>
          <Switch id="reasoningEnabled" checked={reasoningEnabled} onCheckedChange={(v)=>setReasoningEnabled(!!v)} />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="reasoningDefaultExpand">默认展开</Label>
            <p className="text-sm text-muted-foreground">仅影响默认展示，用户可手动折叠/展开。</p>
          </div>
          <Switch id="reasoningDefaultExpand" checked={reasoningDefaultExpand} onCheckedChange={(v)=>setReasoningDefaultExpand(!!v)} />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="reasoningSaveToDb">保存到数据库</Label>
            <p className="text-sm text-muted-foreground">可能包含中间推断过程，请按需开启。</p>
          </div>
          <Switch id="reasoningSaveToDb" checked={reasoningSaveToDb} onCheckedChange={(v)=>setReasoningSaveToDb(!!v)} />
        </div>

        <div className="grid gap-2">
          <Label>标签模式</Label>
          <div className="flex items-center gap-2">
            <Select value={reasoningTagsMode} onValueChange={(v)=>setReasoningTagsMode(v as any)}>
              <SelectTrigger className="w-48"><SelectValue placeholder="选择模式" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="default">默认</SelectItem>
                <SelectItem value="custom">自定义</SelectItem>
                <SelectItem value="off">关闭</SelectItem>
              </SelectContent>
            </Select>
            {reasoningTagsMode === 'custom' && (
              <Input placeholder='["<think>","</think>"]' value={reasoningCustomTags} onChange={(e)=>setReasoningCustomTags(e.target.value)} className="flex-1" />
            )}
          </div>
          <p className="text-xs text-muted-foreground">默认包含 &lt;think&gt; / &lt;|begin_of_thought|&gt; 等常见标签。</p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="deltaSize">流式增量聚合（分片大小）</Label>
          <div className="flex items-center gap-2">
            <Input id="deltaSize" type="number" min={1} max={100} value={streamDeltaChunkSize} onChange={(e)=>setStreamDeltaChunkSize(Number(e.target.value||1))} className="w-36" />
            <span className="text-sm text-muted-foreground">越大则刷新更平滑但延迟稍增</span>
          </div>
        </div>

        <div className="grid gap-2">
          <Label>OpenAI reasoning_effort</Label>
          <div className="flex items-center gap-2">
            <Select value={openaiReasoningEffort} onValueChange={(v)=>setOpenaiReasoningEffort(v as any)}>
              <SelectTrigger className="w-48"><SelectValue placeholder="不设置" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">不设置</SelectItem>
                <SelectItem value="low">low</SelectItem>
                <SelectItem value="medium">medium</SelectItem>
                <SelectItem value="high">high</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">仅对支持该参数的模型生效</span>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="ollamaThink">Ollama think</Label>
            <p className="text-sm text-muted-foreground">上游为 Ollama 时按需启用。</p>
          </div>
          <Switch id="ollamaThink" checked={ollamaThink} onCheckedChange={(v)=>setOllamaThink(!!v)} />
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isLoading}>保存</Button>
        </div>
      </div>
    </div>
  )
}
