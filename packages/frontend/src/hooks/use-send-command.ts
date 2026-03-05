'use client'

import { useCallback } from 'react'
import type { ComposerImage } from '@/features/chat/composer'

interface UseSendCommandParams {
  input: string
  currentSession: { id: number } | null
  concurrencyLocked: boolean
  totalActiveStreams: number
  maxConcurrentStreams: number
  clearError: () => void
  isVisionEnabled: boolean
  selectedImages: ComposerImage[]
  setSelectedImages: (images: ComposerImage[]) => void
  buildRequestPayload: () => { ok: true; customBody?: Record<string, unknown>; customHeaders?: Array<{ name: string; value: string }> } | { ok: false; reason: string }
  enabledExtraSkills: string[]
  webSearchEnabled: boolean
  canUseWebSearch: boolean
  webSearchScope: string
  isMetasoEngine: boolean
  webSearchIncludeSummary?: boolean
  webSearchIncludeRaw?: boolean
  canUsePythonTool: boolean
  pythonToolEnabled: boolean
  thinkingEnabled: boolean
  effort: 'low' | 'medium' | 'high' | 'unset'
  ollamaThink: boolean
  noSaveThisRound: boolean
  setNoSaveThisRound: (value: boolean) => void
  traceEnabled: boolean
  canUseTrace: boolean
  knowledgeBaseIds?: number[]
  streamMessage: (
    sessionId: number,
    message: string,
    images?: Array<{ data: string; mime: string }>,
    options?: Record<string, unknown>,
  ) => Promise<void>
  toast: (params: { title: string; description?: string; variant?: 'destructive' | 'default' }) => void
  setInput: (value: string) => void
}

export const useSendCommand = (params: UseSendCommandParams) => {
  const {
    input,
    currentSession,
    concurrencyLocked,
    totalActiveStreams,
    maxConcurrentStreams,
    clearError,
    isVisionEnabled,
    selectedImages,
    setSelectedImages,
    buildRequestPayload,
    enabledExtraSkills,
    webSearchEnabled,
    canUseWebSearch,
    webSearchScope,
    isMetasoEngine,
    webSearchIncludeSummary,
    webSearchIncludeRaw,
    canUsePythonTool,
    pythonToolEnabled,
    thinkingEnabled,
    effort,
    ollamaThink,
    noSaveThisRound,
    setNoSaveThisRound,
    traceEnabled,
    canUseTrace,
    knowledgeBaseIds,
    streamMessage,
    toast,
    setInput,
  } = params

  return useCallback(async () => {
    if (!input.trim() || !currentSession) return
    if (concurrencyLocked) {
      toast({
        title: '生成任务已达上限',
        description: `当前共有 ${totalActiveStreams}/${maxConcurrentStreams} 个请求进行中，请稍候或先停止部分任务。`,
        variant: 'destructive',
      })
      return
    }
    const message = input.trim()
    const prevSelectedImages = selectedImages
    setInput('')
    clearError()
    try {
      const imagesPayload =
        isVisionEnabled && prevSelectedImages.length
          ? prevSelectedImages.map((img) => ({ data: img.dataUrl.split(',')[1], mime: img.mime }))
          : undefined
      if (prevSelectedImages.length > 0) {
        setSelectedImages([])
      }
      const requestPayload = buildRequestPayload()
      if (!requestPayload.ok) {
        toast({ title: '发送失败', description: requestPayload.reason, variant: 'destructive' })
        return
      }
      const enabledSkills: string[] = [...enabledExtraSkills]
      const skillOverrides: Record<string, Record<string, unknown>> = {}
      if (webSearchEnabled && canUseWebSearch) {
        enabledSkills.push('web-search', 'url-reader')
        const webSearchOverride: Record<string, unknown> = {}
        if (isMetasoEngine) webSearchOverride.scope = webSearchScope
        if (webSearchIncludeSummary) webSearchOverride.includeSummary = true
        if (webSearchIncludeRaw) webSearchOverride.includeRawContent = true
        if (Object.keys(webSearchOverride).length > 0) {
          skillOverrides['web-search'] = webSearchOverride
        }
      }
      if (pythonToolEnabled && canUsePythonTool) {
        enabledSkills.push('python-runner')
      }
      const skillsPayload =
        enabledSkills.length > 0
          ? {
              enabled: Array.from(new Set(enabledSkills)),
              ...(Object.keys(skillOverrides).length > 0 ? { overrides: skillOverrides } : {}),
            }
          : undefined
      const options = {
        reasoningEnabled: thinkingEnabled,
        reasoningEffort: effort !== 'unset' ? (effort as any) : undefined,
        ollamaThink: thinkingEnabled ? ollamaThink : undefined,
        saveReasoning: !noSaveThisRound,
        skills: skillsPayload,
        traceEnabled: canUseTrace ? traceEnabled : undefined,
        customBody: requestPayload.customBody,
        customHeaders: requestPayload.customHeaders,
        knowledgeBaseIds: knowledgeBaseIds?.length ? knowledgeBaseIds : undefined,
      }
      await streamMessage(currentSession.id, message, imagesPayload, options)
      setNoSaveThisRound(false)
    } catch (error) {
      if (prevSelectedImages.length > 0) {
        setSelectedImages(prevSelectedImages)
      }
      console.error('Failed to send message:', error)
      toast({
        title: '发送失败',
        description: error instanceof Error ? error.message : '未知错误',
        variant: 'destructive',
      })
    }
  }, [
    input,
    currentSession,
    concurrencyLocked,
    totalActiveStreams,
    maxConcurrentStreams,
    clearError,
    isVisionEnabled,
    selectedImages,
    setSelectedImages,
    buildRequestPayload,
    enabledExtraSkills,
    webSearchEnabled,
    canUseWebSearch,
    webSearchScope,
    isMetasoEngine,
    webSearchIncludeSummary,
    webSearchIncludeRaw,
    canUsePythonTool,
    pythonToolEnabled,
    thinkingEnabled,
    effort,
    ollamaThink,
    noSaveThisRound,
    setNoSaveThisRound,
    traceEnabled,
    canUseTrace,
    knowledgeBaseIds,
    streamMessage,
    toast,
    setInput,
  ])
}
