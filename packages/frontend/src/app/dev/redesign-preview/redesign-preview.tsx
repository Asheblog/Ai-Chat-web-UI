'use client'

import { useEffect, useState } from 'react'
import { ModelSelector } from '@/components/model-selector'
import { CotTimeline } from '@/components/message-bubble/cot-timeline'
import { useModelsStore, type ModelItem } from '@/store/models-store'
import { modelKeyFor } from '@/store/model-preference-store'
import { previewMeta, previewModels, previewReasoning, previewTools } from './preview-data'

type ModelState = 'ready' | 'loading' | 'empty' | 'error'

export function RedesignPreview() {
  const [selected, setSelected] = useState<ModelItem>(previewModels[0])
  const [modelState, setModelState] = useState<ModelState>('ready')
  const [streaming, setStreaming] = useState(false)
  const [partialFailure, setPartialFailure] = useState(false)
  const [disabled, setDisabled] = useState(false)
  const [dark, setDark] = useState(false)
  useEffect(() => {
    const previous = useModelsStore.getState()
    const ready = async () => {
      setModelState('ready')
      useModelsStore.setState({ models: previewModels, isLoading: false, error: null })
    }
    useModelsStore.setState({
      models: modelState === 'empty' || modelState === 'loading' ? [] : previewModels,
      isLoading: modelState === 'loading',
      error: modelState === 'error' ? '模型暂时加载失败，请重试。' : null,
      fetchAll: ready,
    })
    return () => useModelsStore.setState(previous)
  }, [modelState])
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    return () => document.documentElement.classList.remove('dark')
  }, [dark])
  const completedTools = previewTools.map(event => event.status === 'error' && !partialFailure
    ? { ...event, stage: 'result' as const, status: 'success' as const, summary: '已读取网页正文', resultText: '开发预览来源内容。' }
    : event)
  const events = streaming
    ? [...completedTools.slice(0, 4), { ...completedTools[4], stage: 'start' as const, status: 'running' as const }]
    : completedTools

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-4 py-3">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3 text-sm">
          <h1 className="mr-auto font-semibold">界面改造 · 开发预览</h1>
          <label className="flex items-center gap-2">模型状态
            <select aria-label="预览模型状态" value={modelState} onChange={e => setModelState(e.target.value as ModelState)} className="rounded border border-border bg-background p-1">
              <option value="ready">正常</option><option value="loading">加载中</option><option value="empty">无模型</option><option value="error">错误</option>
            </select>
          </label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={streaming} onChange={e => setStreaming(e.target.checked)} />运行中</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={partialFailure} onChange={e => setPartialFailure(e.target.checked)} />部分失败</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={disabled} onChange={e => setDisabled(e.target.checked)} />禁用</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={dark} onChange={e => setDark(e.target.checked)} />深色</label>
        </div>
      </header>
      <div className="mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-8 sm:py-12">
        <div className="ml-auto max-w-lg rounded-2xl bg-muted/50 px-5 py-4">帮我查一下 Figma 免费版的限制。</div>
        <section aria-label="助手回答" className="space-y-6">
          <CotTimeline meta={previewMeta(streaming ? 'redesign-live' : 'redesign-done', streaming)} reasoningRaw={previewReasoning} toolEvents={events} isStreaming={streaming} reasoningPlayedLength={previewReasoning.length} />
          {!streaming && <article className="space-y-4 leading-7"><h2 className="text-xl font-semibold">选择适合自己的协作方式</h2><p>个人探索和团队协作的需求不同。先确认文件组织、协作方式和交付需求，再决定使用哪个方案。</p><p className="text-sm text-muted-foreground">这里是开发预览内容，用于检查正文、过程摘要和模型选择器的相对层级。</p></article>}
        </section>
        <div className="space-y-3 rounded-2xl border border-border bg-surface p-4 sm:p-5">
          <textarea aria-label="消息输入" placeholder="继续输入…" className="min-h-20 w-full resize-none bg-transparent outline-none placeholder:text-muted-foreground" />
          <div className="flex min-w-0 items-center justify-between gap-3"><span className="text-xs text-muted-foreground">开发预览</span><ModelSelector selectedModelId={modelKeyFor(selected)} onModelChange={setSelected} disabled={disabled} /></div>
        </div>
        <output data-testid="selected-model" className="block break-all text-xs text-muted-foreground">当前选择：{selected.name} · {selected.displayName} · 连接 {selected.connectionId}</output>
      </div>
    </main>
  )
}
