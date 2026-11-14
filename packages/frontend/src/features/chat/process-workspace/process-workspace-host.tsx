'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { cn } from '@/lib/utils'
import type {
  ProcessSnapshot,
  ProcessWorkspaceHostApi,
  ProcessWorkspaceHostProps,
} from './types'
import { useProcessLayoutMode } from './hooks/use-process-layout-mode'
import { useProcessModel } from './hooks/use-process-model'
import { resolveProcessScope } from './model/scope'
import { isSameProcessSnapshot } from './model/snapshot'
import { persistProcessLevel } from './model/disclosure'
import { ProcessPanel } from './views/process-panel'
import { ProcessDrawer } from './views/process-drawer'

const ProcessWorkspaceHostContext = createContext<ProcessWorkspaceHostApi | null>(null)

/**
 * 可选宿主：没有 Host 时返回 null，调用方据此退化为"本地抽屉"，不报错。
 * 主聊天用它判断工作区是否打开（打开时隐藏 reading-nav 目录，关闭即恢复）。
 */
export function useOptionalProcessWorkspace(): ProcessWorkspaceHostApi | null {
  return useContext(ProcessWorkspaceHostContext)
}

export function useProcessWorkspaceOpen(): boolean {
  const host = useOptionalProcessWorkspace()
  return host?.activeKey != null
}

/**
 * 主聊天宿主：包住整个 flex 区域。≥1440 出 440px 内联侧栏，768—1439 覆盖，
 * <768 全屏。侧栏模式自己处理 Esc 与还焦点；覆盖/全屏交给 Radix Sheet。
 * 宿主只保存快照，不请求、不改 store，Entry 卸载后仍能展示最后一份实时快照。
 */
export function ProcessWorkspaceHost({ children, width = 440, className }: ProcessWorkspaceHostProps) {
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [snapshots, setSnapshots] = useState<Record<string, ProcessSnapshot>>({})
  const triggerRef = useRef<HTMLElement | null>(null)
  const mode = useProcessLayoutMode()

  const restoreFocus = useCallback(() => {
    const node = triggerRef.current
    triggerRef.current = null
    if (!node) return
    if (typeof node.isConnected === 'boolean' && !node.isConnected) return
    node.focus?.()
  }, [])

  // 只在结构性事实变化时更新：引用变但内容没变时不重渲染，也不打断焦点。
  const store = useCallback((key: string, snapshot: ProcessSnapshot) => {
    setSnapshots((previous) =>
      isSameProcessSnapshot(previous[key] ?? null, snapshot) ? previous : { ...previous, [key]: snapshot },
    )
  }, [])

  const openEntry = useCallback(
    (key: string, snapshot: ProcessSnapshot) => {
      if (typeof document !== 'undefined') {
        const active = document.activeElement
        triggerRef.current = active instanceof HTMLElement ? active : null
      }
      store(key, snapshot)
      setActiveKey(key)
    },
    [store],
  )

  const publish = useCallback((key: string, snapshot: ProcessSnapshot) => store(key, snapshot), [store])

  // 关闭也要落偏好：否则"用户关掉了"这件事下次不会被记住（S-3）。
  const activeKeyRef = useRef<string | null>(null)
  activeKeyRef.current = activeKey

  const closeEntry = useCallback(() => {
    const key = activeKeyRef.current
    if (key) persistProcessLevel(key, 'collapsed')
    setActiveKey(null)
    restoreFocus()
  }, [restoreFocus])

  const api = useMemo<ProcessWorkspaceHostApi>(
    () => ({ openEntry, publish, closeEntry, activeKey }),
    [openEntry, publish, closeEntry, activeKey],
  )

  const snapshot = activeKey ? snapshots[activeKey] ?? null : null
  const inline = mode === 'sidebar'
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const focusedForRef = useRef<string | null>(null)

  // 打开时把焦点交给面板容器一次；之后流式 publish 新快照不再抢焦点，
  // 否则用户正在台账搜索框/按钮上打字会被打断。
  useEffect(() => {
    if (!inline || !activeKey) {
      focusedForRef.current = null
      return
    }
    if (focusedForRef.current === activeKey) return
    focusedForRef.current = activeKey
    surfaceRef.current?.focus()
  }, [inline, activeKey])

  // 内联侧栏不是模态：Esc 自己听（关闭时由宿主把焦点还给触发按钮）。
  useEffect(() => {
    if (!inline || !activeKey) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      closeEntry()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [inline, activeKey, closeEntry])

  return (
    <ProcessWorkspaceHostContext.Provider value={api}>
      <div className={cn('flex min-h-0 min-w-0 flex-1 overflow-hidden', className)}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>

        {inline && snapshot && (
          <aside
            aria-label="过程工作区"
            style={{ width }}
            className="flex min-h-0 shrink-0 flex-col border-l border-border bg-surface"
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.stopPropagation()
              closeEntry()
            }}
          >
            <div ref={surfaceRef} tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
              <WorkspaceSurface
              key={snapshot.meta.stableKey || String(snapshot.meta.id)}
              snapshot={snapshot}
              onClose={closeEntry}
            />
            </div>
          </aside>
        )}

        {!inline && (
          <ProcessDrawer
            open={Boolean(snapshot)}
            mode={mode}
            title="本轮工作区"
            onClose={closeEntry}
          >
            {snapshot && (
              <WorkspaceSurface
                key={snapshot.meta.stableKey || String(snapshot.meta.id)}
                snapshot={snapshot}
                onClose={closeEntry}
              />
            )}
          </ProcessDrawer>
        )}
      </div>
    </ProcessWorkspaceHostContext.Provider>
  )
}

/** 侧栏与抽屉共用同一份面板内容：从快照解析作用域与派生数据。 */
function WorkspaceSurface({ snapshot, onClose }: { snapshot: ProcessSnapshot; onClose: () => void }) {
  const scope = resolveProcessScope(snapshot.meta, { readOnly: snapshot.readOnly })
  const model = useProcessModel(snapshot)
  return <ProcessPanel snapshot={snapshot} scope={scope} model={model} onClose={onClose} />
}
