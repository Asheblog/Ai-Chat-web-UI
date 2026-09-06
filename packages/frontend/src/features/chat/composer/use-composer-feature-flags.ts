import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatSession, SystemSettings } from '@/types'
import type { ModelItem } from '@/store/models-store'

interface UseComposerFeatureFlagsOptions {
  currentSession: ChatSession | null
  systemSettings: SystemSettings | null | undefined
  activeModel: ModelItem | null
  storedWebSearchPreference?: boolean | null
  persistWebSearchPreference: (value: boolean) => void
  storedPythonPreference?: boolean | null
  persistPythonPreference: (value: boolean) => void
  storedDeepResearchPreference?: boolean | null
  persistDeepResearchPreference: (value: boolean) => void
  isAdmin: boolean
  scopePreferenceKey?: string
}

const DEFAULT_SCOPE_KEY = 'web_search_scope_preference'

export const useComposerFeatureFlags = ({
  currentSession,
  systemSettings,
  activeModel,
  storedWebSearchPreference,
  persistWebSearchPreference,
  storedPythonPreference,
  persistPythonPreference,
  storedDeepResearchPreference,
  persistDeepResearchPreference,
  isAdmin,
  scopePreferenceKey = DEFAULT_SCOPE_KEY,
}: UseComposerFeatureFlagsOptions) => {
  const [thinkingEnabled, setThinkingEnabled] = useState(false)
  const [effort, setEffort] = useState<'low' | 'medium' | 'high' | 'max' | 'xhigh' | 'unset'>('unset')
  const [webSearchEnabled, setWebSearchEnabledState] = useState(false)
  const [webSearchScope, setWebSearchScope] = useState('webpage')
  const [pythonToolEnabled, setPythonToolEnabled] = useState(false)
  const [deepResearchEnabled, setDeepResearchEnabled] = useState(false)
  const [traceEnabled, setTraceEnabled] = useState(false)
  const tracePreferenceRef = useRef<Record<number, boolean>>({})

  const isVisionEnabled = useMemo(() => {
    const cap = activeModel?.capabilities?.vision
    return typeof cap === 'boolean' ? cap : true
  }, [activeModel])

  const canUseWebSearch =
    Boolean(systemSettings?.webSearchAgentEnable && systemSettings?.webSearchHasApiKey)

  const canUsePythonTool =
    Boolean(systemSettings?.pythonToolEnable)

  const webSearchDisabledNote = useMemo(() => {
    if (!systemSettings?.webSearchAgentEnable) return '管理员未启用联网搜索'
    if (!systemSettings?.webSearchHasApiKey) return '尚未配置搜索 API Key'
    return undefined
  }, [systemSettings?.webSearchAgentEnable, systemSettings?.webSearchHasApiKey])

  const pythonToolDisabledNote = useMemo(() => {
    if (!systemSettings?.pythonToolEnable) return '管理员未开启 Python 工具'
    return undefined
  }, [systemSettings?.pythonToolEnable])

  const isMetasoEngine = Boolean(
    systemSettings?.webSearchEnabledEngines?.includes('metaso') &&
    systemSettings?.webSearchHasApiKeyMetaso,
  )
  const canUseTrace = Boolean(isAdmin && systemSettings?.taskTraceEnabled)

  useEffect(() => {
    if (!currentSession) return
    const sysEnabled = Boolean(systemSettings?.reasoningEnabled ?? true)
    const sysEffortRaw = (systemSettings?.openaiReasoningEffort ?? '') as any
    const sysEffort: 'low' | 'medium' | 'high' | 'max' | 'xhigh' | 'unset' = sysEffortRaw && sysEffortRaw !== '' ? sysEffortRaw : 'unset'

    setThinkingEnabled(
      typeof currentSession.reasoningEnabled === 'boolean'
        ? Boolean(currentSession.reasoningEnabled)
        : sysEnabled,
    )
    setEffort((currentSession.reasoningEffort as any) || sysEffort)
  }, [
    currentSession,
    currentSession?.id,
    currentSession?.reasoningEnabled,
    currentSession?.reasoningEffort,
    systemSettings?.reasoningEnabled,
    systemSettings?.openaiReasoningEffort,
  ])

  useEffect(() => {
    if (!canUseWebSearch) {
      if (webSearchEnabled) {
        setWebSearchEnabledState(false)
      }
      return
    }
    const desired = typeof storedWebSearchPreference === 'boolean' ? storedWebSearchPreference : true
    if (webSearchEnabled !== desired) {
      setWebSearchEnabledState(desired)
    }
  }, [canUseWebSearch, storedWebSearchPreference, webSearchEnabled])

  useEffect(() => {
    if (!canUsePythonTool) {
      if (pythonToolEnabled) {
        setPythonToolEnabled(false)
      }
      return
    }
    const desired = typeof storedPythonPreference === 'boolean' ? storedPythonPreference : false
    if (pythonToolEnabled !== desired) {
      setPythonToolEnabled(desired)
    }
  }, [canUsePythonTool, pythonToolEnabled, storedPythonPreference])

  useEffect(() => {
    const desired = typeof storedDeepResearchPreference === 'boolean' ? storedDeepResearchPreference : false
    if (deepResearchEnabled !== desired) {
      setDeepResearchEnabled(desired)
    }
  }, [deepResearchEnabled, storedDeepResearchPreference])

  useEffect(() => {
    if (!canUseWebSearch || !isMetasoEngine) {
      setWebSearchScope('webpage')
      return
    }
    const stored = (() => {
      try {
        return localStorage.getItem(scopePreferenceKey) || ''
      } catch {
        return ''
      }
    })()
    const fromSetting = systemSettings?.webSearchScope || 'webpage'
    const next = stored || fromSetting || 'webpage'
    if (next && webSearchScope !== next) {
      setWebSearchScope(next)
    }
    if (!stored && next) {
      try {
        localStorage.setItem(scopePreferenceKey, next)
      } catch {
        // ignore storage error
      }
    }
  }, [canUseWebSearch, isMetasoEngine, systemSettings?.webSearchScope, webSearchScope, scopePreferenceKey])

  useEffect(() => {
    if (!canUseTrace) {
      setTraceEnabled(false)
      return
    }
    if (!currentSession) return
    const stored = tracePreferenceRef.current[currentSession.id]
    if (typeof stored === 'boolean') {
      setTraceEnabled(stored)
    } else {
      setTraceEnabled(Boolean(systemSettings?.taskTraceDefaultOn))
    }
  }, [canUseTrace, currentSession, currentSession?.id, systemSettings?.taskTraceDefaultOn])

  const setWebSearchEnabled = useCallback((value: boolean) => {
    setWebSearchEnabledState(value)
    persistWebSearchPreference(value)
  }, [persistWebSearchPreference])

  const setPythonToolEnabledState = useCallback((value: boolean) => {
    setPythonToolEnabled(value)
    persistPythonPreference(value)
  }, [persistPythonPreference])

  const setDeepResearchEnabledState = useCallback((value: boolean) => {
    setDeepResearchEnabled(value)
    persistDeepResearchPreference(value)
  }, [persistDeepResearchPreference])

  const handleWebSearchScopeChange = useCallback((value: string) => {
    setWebSearchScope(value)
    try {
      localStorage.setItem(scopePreferenceKey, value)
    } catch {
      // ignore storage error
    }
  }, [scopePreferenceKey])

  const handleTraceToggle = useCallback((value: boolean) => {
    if (!currentSession) return
    tracePreferenceRef.current[currentSession.id] = value
    setTraceEnabled(value)
  }, [currentSession])

  return {
    thinkingEnabled,
    setThinkingEnabled,
    effort,
    setEffort,
    webSearchEnabled,
    setWebSearchEnabled,
    webSearchScope,
    setWebSearchScope: handleWebSearchScopeChange,
    pythonToolEnabled,
    setPythonToolEnabled: setPythonToolEnabledState,
    deepResearchEnabled,
    setDeepResearchEnabled: setDeepResearchEnabledState,
    traceEnabled,
    onToggleTrace: handleTraceToggle,
    canUseTrace,
    canUseWebSearch,
    canUsePythonTool,
    webSearchDisabledNote,
    pythonToolDisabledNote,
    isMetasoEngine,
    showWebSearchScope: canUseWebSearch && isMetasoEngine,
    isVisionEnabled,
  }
}
