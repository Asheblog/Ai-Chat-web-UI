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
  isAdmin,
  scopePreferenceKey = DEFAULT_SCOPE_KEY,
}: UseComposerFeatureFlagsOptions) => {
  const [thinkingEnabled, setThinkingEnabled] = useState(false)
  const [effort, setEffort] = useState<'low' | 'medium' | 'high' | 'unset'>('unset')
  const [ollamaThink, setOllamaThink] = useState(false)
  const [webSearchEnabled, setWebSearchEnabledState] = useState(false)
  const [webSearchScope, setWebSearchScope] = useState('webpage')
  const [pythonToolEnabled, setPythonToolEnabled] = useState(false)
  const [traceEnabled, setTraceEnabled] = useState(false)
  const tracePreferenceRef = useRef<Record<number, boolean>>({})

  const isVisionEnabled = useMemo(() => {
    const cap = activeModel?.capabilities?.vision
    return typeof cap === 'boolean' ? cap : true
  }, [activeModel])

  const isWebSearchCapable = useMemo(() => {
    const cap = activeModel?.capabilities?.web_search
    return typeof cap === 'boolean' ? cap : true
  }, [activeModel])

  const pythonToolCapable = useMemo(() => {
    const cap = activeModel?.capabilities?.code_interpreter
    return typeof cap === 'boolean' ? cap : true
  }, [activeModel])

  const canUseWebSearch =
    Boolean(systemSettings?.webSearchAgentEnable && systemSettings?.webSearchHasApiKey) &&
    isWebSearchCapable

  const canUsePythonTool =
    Boolean(systemSettings?.pythonToolEnable) && pythonToolCapable

  const webSearchDisabledNote = useMemo(() => {
    if (!systemSettings?.webSearchAgentEnable) return '管理员未启用联网搜索'
    if (!systemSettings?.webSearchHasApiKey) return '尚未配置搜索 API Key'
    if (!isWebSearchCapable) return '当前模型未开放联网搜索'
    return undefined
  }, [systemSettings?.webSearchAgentEnable, systemSettings?.webSearchHasApiKey, isWebSearchCapable])

  const pythonToolDisabledNote = useMemo(() => {
    if (!systemSettings?.pythonToolEnable) return '管理员未开启 Python 工具'
    if (!pythonToolCapable) return '当前模型未启用 Python 工具'
    return undefined
  }, [pythonToolCapable, systemSettings?.pythonToolEnable])

  const isMetasoEngine = (systemSettings?.webSearchDefaultEngine || '').toLowerCase() === 'metaso'
  const canUseTrace = Boolean(isAdmin && systemSettings?.taskTraceEnabled)

  useEffect(() => {
    if (!currentSession) return
    const sysEnabled = Boolean(systemSettings?.reasoningEnabled ?? true)
    const sysEffortRaw = (systemSettings?.openaiReasoningEffort ?? '') as any
    const sysEffort: 'low' | 'medium' | 'high' | 'unset' = sysEffortRaw && sysEffortRaw !== '' ? sysEffortRaw : 'unset'
    const sysOllamaThink = Boolean(systemSettings?.ollamaThink ?? false)

    setThinkingEnabled(
      typeof currentSession.reasoningEnabled === 'boolean'
        ? Boolean(currentSession.reasoningEnabled)
        : sysEnabled,
    )
    setEffort((currentSession.reasoningEffort as any) || sysEffort)
    setOllamaThink(
      typeof currentSession.ollamaThink === 'boolean'
        ? Boolean(currentSession.ollamaThink)
        : sysOllamaThink,
    )
  }, [
    currentSession,
    currentSession?.id,
    currentSession?.reasoningEnabled,
    currentSession?.reasoningEffort,
    currentSession?.ollamaThink,
    systemSettings?.reasoningEnabled,
    systemSettings?.openaiReasoningEffort,
    systemSettings?.ollamaThink,
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
    ollamaThink,
    setOllamaThink,
    webSearchEnabled,
    setWebSearchEnabled,
    webSearchScope,
    setWebSearchScope: handleWebSearchScopeChange,
    pythonToolEnabled,
    setPythonToolEnabled: setPythonToolEnabledState,
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
