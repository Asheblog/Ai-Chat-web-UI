'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ProcessSnapshot, ProcessWorkspaceEntryProps } from './types'
import { useOptionalProcessWorkspace } from './process-workspace-host'
import { useProcessLevel } from './hooks/use-process-disclosure'
import { useProcessModel } from './hooks/use-process-model'
import { useProcessLayoutMode } from './hooks/use-process-layout-mode'
import { formatProcessDuration, resolveProcessScope } from './model/scope'
import { ProcessSummaryBar } from './views/summary-bar'
import { ProcessPanel } from './views/process-panel'
import { ProcessDrawer } from './views/process-drawer'

const buildStatusText = (
  meta: ProcessWorkspaceEntryProps['meta'],
  isStreaming: boolean,
  finalAnswerMissing: boolean,
): string => {
  if (finalAnswerMissing) return '未生成最终回答'
  if (isStreaming) return '进行中'
  if (meta.streamStatus === 'error') return '本轮出错'
  if (meta.streamStatus === 'cancelled') return '已取消'
  return '已完成'
}

/**
 * 过程摘要入口 —— 原 CotTimeline 的替换点。
 * 折叠态是一行摘要，点开才出工作区；答案由调用方渲染，这里不碰答案区。
 * 有宿主时交给宿主渲染（≥1440 双栏），没有宿主时自己开本地抽屉。
 */
export function ProcessWorkspaceEntry({
  meta,
  reasoningRaw,
  toolEvents,
  content,
  artifacts,
  coverage,
  readOnly,
  commands,
  defaultExpanded = false,
  defaultTab,
  presentation = 'drawer',
  isStreaming = false,
  reasoningPlayedLength,
  runTerminal,
  onOpen,
  className,
}: ProcessWorkspaceEntryProps) {
  const host = useOptionalProcessWorkspace()
  const mode = useProcessLayoutMode()
  const scope = resolveProcessScope(meta, { readOnly })
  const bodyId = useId()

  const snapshot: ProcessSnapshot = useMemo(
    () => ({
      meta,
      reasoningRaw: reasoningRaw ?? '',
      toolEvents: toolEvents ?? [],
      content,
      artifacts,
      coverage,
      readOnly,
      commands,
      isStreaming,
      reasoningPlayedLength,
      runTerminal,
    }),
    [
      meta,
      reasoningRaw,
      toolEvents,
      content,
      artifacts,
      coverage,
      readOnly,
      commands,
      isStreaming,
      reasoningPlayedLength,
      runTerminal,
    ],
  )

  const model = useProcessModel(snapshot)
  const { open: preferredOpen, setOpen: persistOpen } = useProcessLevel({
    scopeKey: scope.key,
    defaultExpanded,
  })
  const [localOpen, setLocalOpen] = useState<boolean | null>(null)
  const { publish, openEntry, closeEntry, activeKey } = host ?? {}
  const open = host ? activeKey === scope.key : localOpen ?? preferredOpen

  // 宿主路径也尊重既有披露偏好：用户手选过 outline/expanded 的消息，回到聊天时仍打开。
  // 只在不占用宿主的空状态下自动打开一次，且不因流式自动展开（答案优先）。
  const autoOpened = useRef(false)
  useEffect(() => {
    if (!host || !preferredOpen || autoOpened.current) return
    if (host.activeKey !== null) return
    autoOpened.current = true
    host.openEntry(scope.key, snapshot)
  }, [host, preferredOpen, scope.key, snapshot])

  // 打开中的实时快照持续发布给宿主：消息行被虚拟列表卸载也不丢过程。
  useEffect(() => {
    if (!open || !publish) return
    publish(scope.key, snapshot)
  }, [open, publish, scope.key, snapshot])

  // 只在关闭→打开边沿回调一次（defaultExpanded 首次挂载也算打开）。
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) onOpen?.()
    wasOpen.current = open
  }, [open, onOpen])

  // 关闭后把焦点还给摘要按钮：本地抽屉没有 Radix Trigger 可还，必须自己做。
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const focusReturnArmed = useRef(false)
  useEffect(() => {
    if (focusReturnArmed.current && !open && !host) triggerRef.current?.focus()
    focusReturnArmed.current = open
  }, [open, host])

  const setOpen = useCallback(
    (next: boolean) => {
      // 用户自己开合过就不再走"按偏好自动打开"，否则关闭会被下次渲染重新打开。
      autoOpened.current = true
      persistOpen(next)
      if (openEntry || closeEntry) {
        if (next) openEntry?.(scope.key, snapshot)
        else closeEntry?.()
        return
      }
      setLocalOpen(next)
    },
    [persistOpen, openEntry, closeEntry, scope.key, snapshot],
  )

  const statusText = buildStatusText(meta, isStreaming, model.terminal.finalAnswerMissing)
  const anomalyCount = useMemo(
    () => new Set(model.anomalies.flatMap((group) => group.ids)).size,
    [model.anomalies],
  )
  // 普通空消息不渲染多余栏；但终态/产物/进行中本身就是需要入口的状态：
  // 首轮还没有工具时也要能打开并停止后续工具，未生成最终回答必须有地方可看。
  const hasProcess =
    model.index.records.length > 0 ||
    Boolean(reasoningRaw?.trim()) ||
    (artifacts?.length ?? 0) > 0 ||
    isStreaming ||
    model.terminal.finalAnswerMissing ||
    Boolean(model.terminal.stopReason)
  if (!hasProcess) return null

  return (
    <div className={className} data-process-scope={scope.key} data-process-origin={scope.origin}>
      <ProcessSummaryBar
        statusText={statusText}
        durationText={formatProcessDuration(meta.reasoningDurationSeconds)}
        terminal={model.terminal}
        anomalyCount={anomalyCount}
        activity={isStreaming ? model.activity : null}
        isStreaming={isStreaming}
        expanded={open}
        bodyId={bodyId}
        presentation={presentation}
        onOpen={() => setOpen(true)}
        triggerRef={triggerRef}
      />
      {!host && presentation === 'inline' && open && (
        <div id={bodyId} className="rounded-xl border border-border bg-surface" aria-label="过程工作区">
          <ProcessPanel
            snapshot={snapshot}
            scope={scope}
            model={model}
            defaultTab={defaultTab}
            expandAll={defaultExpanded}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
      {!host && presentation === 'drawer' && (
        <ProcessDrawer open={open} mode={mode} title="本轮工作区" onClose={() => setOpen(false)}>
          <ProcessPanel
            snapshot={snapshot}
            scope={scope}
            model={model}
            defaultTab={defaultTab}
            expandAll={defaultExpanded}
            onClose={() => setOpen(false)}
          />
        </ProcessDrawer>
      )}
    </div>
  )
}
