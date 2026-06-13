"use client"

import { useEffect, useRef, useState } from "react"
import { DEFAULT_SYSTEM_LEAF, renderSystemLeaf } from "./settings/system-settings-registry"

const MODULE_STORAGE_KEY = "settings:system:v2-module"

type SystemSettingsProps = {
  activeKey?: string
}

export function SystemSettings({ activeKey }: SystemSettingsProps) {
  // Controlled mode: render specified leaf, no side effects
  if (activeKey !== undefined) {
    const content = renderSystemLeaf(activeKey)
    if (!content) {
      return (
        <div className="v2-panel-soft p-6 text-sm text-muted-foreground">
          暂无可用的系统设置模块
        </div>
      )
    }
    return <div className="min-w-0">{content}</div>
  }

  // Uncontrolled mode: manage internal state, listen for events, persist to localStorage
  return <SystemSettingsUncontrolled />
}

function SystemSettingsUncontrolled() {
  const [activeKey, setActiveKey] = useState(DEFAULT_SYSTEM_LEAF)
  const initialKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (typeof window === "undefined") return
    const saved = window.localStorage.getItem(MODULE_STORAGE_KEY)
    if (saved && !initialKeyRef.current && renderSystemLeaf(saved) !== null) {
      initialKeyRef.current = saved
      setActiveKey(saved)
    }

    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail
      if (detail?.key && renderSystemLeaf(detail.key) !== null) {
        setActiveKey(detail.key)
        window.localStorage.setItem(MODULE_STORAGE_KEY, detail.key)
      }
    }

    window.addEventListener("aichat:system-settings-select", handler as EventListener)
    return () => {
      window.removeEventListener("aichat:system-settings-select", handler as EventListener)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("aichat:system-settings-active", { detail: { key: activeKey } }))
    }
  }, [activeKey])

  const content = renderSystemLeaf(activeKey)

  if (!content) {
    return (
      <div className="v2-panel-soft p-6 text-sm text-muted-foreground">
        暂无可用的系统设置模块
      </div>
    )
  }

  return <div className="min-w-0">{content}</div>
}

export default SystemSettings
