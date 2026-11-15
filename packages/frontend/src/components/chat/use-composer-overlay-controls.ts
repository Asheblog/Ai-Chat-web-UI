'use client'

import { useEffect, useRef, useState } from 'react'
import { COMPOSER_TOOLS_HANDOFF_MS, type ComposerToolsPanelView } from './composer-tools-panel'
import type { ModelSelectorView } from '@/components/model-selector/model-selector-types'

/** Shared transitions for the welcome, desktop and mobile composer overlays. */
export function useComposerOverlayControls() {
  const [toolsOpen, updateToolsOpen] = useState(false)
  const [toolsView, setToolsView] = useState<ComposerToolsPanelView>('capabilities')
  const [skillPanelOpen, setSkillPanelOpen] = useState(false)
  const [selectorOpen, updateSelectorOpen] = useState(false)
  const [selectorView, setSelectorView] = useState<ModelSelectorView>('models')
  const handoffRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (handoffRef.current !== null) clearTimeout(handoffRef.current) }, [])
  const setToolsOpen = (open: boolean) => {
    updateToolsOpen(open)
    if (!open) setToolsView('capabilities')
  }
  const setSelectorOpen = (open: boolean) => {
    updateSelectorOpen(open)
    if (!open) setSelectorView('models')
  }
  const openTools = (view: ComposerToolsPanelView) => {
    setToolsView(view)
    updateToolsOpen(true)
  }
  const runFromTools = (action?: () => void) => {
    setToolsOpen(false)
    if (handoffRef.current !== null) clearTimeout(handoffRef.current)
    if (action) handoffRef.current = setTimeout(action, COMPOSER_TOOLS_HANDOFF_MS)
  }
  const openSkillPanelFromTools = () => runFromTools(() => setSkillPanelOpen(true))
  const openEffortView = () => { setSelectorView('effort'); updateSelectorOpen(true) }
  return { toolsOpen, setToolsOpen, toolsView, setToolsView, skillPanelOpen, setSkillPanelOpen,
    selectorOpen, setSelectorOpen, selectorView, openTools, runFromTools, openSkillPanelFromTools, openEffortView }
}
