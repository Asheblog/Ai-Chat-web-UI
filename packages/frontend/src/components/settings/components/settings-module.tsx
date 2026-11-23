"use client"

import { lazy, Suspense, useRef, useState, type ComponentType, type LazyExoticComponent } from "react"
import { Button } from "@/components/ui/button"

/** Load a settings panel on first render; retry only failed imports, not panel render errors. */
export function createSettingsModule(load: () => Promise<ComponentType>, label: string) {
  type AttemptProps = { retry: () => void }
  let loadedAttempt: LazyExoticComponent<ComponentType<AttemptProps>> | undefined

  function createAttempt() {
    const Attempt = lazy<ComponentType<AttemptProps>>(async () => {
      try {
        const Loaded = await load()
        loadedAttempt = Attempt
        return { default: () => <Loaded /> }
      } catch (error) {
        console.error("Failed to load settings panel:", label, error)
        return {
          default: ({ retry }: { retry: () => void }) => (
            <div className="v2-panel-soft flex flex-wrap items-center justify-between gap-3 p-6 text-sm">
              <div role="alert">
                <p className="font-medium text-destructive">{label}加载失败</p>
                <p className="mt-1 text-muted-foreground">重试后仍失败，请刷新页面。</p>
              </div>
              <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={retry}>重试</Button>
            </div>
          ),
        }
      }
    })
    return Attempt
  }

  return function SettingsModule() {
    const [Attempt, setAttempt] = useState(() => loadedAttempt ?? createAttempt())
    const panel = useRef<HTMLDivElement>(null)

    function retry() {
      // Keep keyboard focus in the panel when the retry button is replaced.
      panel.current?.focus({ preventScroll: true })
      // A lazy component caches its first result, including the failure panel.
      setAttempt(loadedAttempt ?? createAttempt())
    }

    return (
      <div ref={panel} tabIndex={-1}>
        <Suspense fallback={
          <div role="status" className="v2-panel-soft p-6 text-sm text-muted-foreground">
            正在加载{label}…
          </div>
        }>
          <Attempt retry={retry} />
        </Suspense>
      </div>
    )
  }
}
