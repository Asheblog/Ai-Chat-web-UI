'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Settings } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/components/ui/use-toast'
import { useAuthStore } from '@/store/auth-store'
import { useModelsStore } from '@/store/models-store'
import { refreshModelCatalog } from '@/features/system/api'
import { getSetupStatus, setSetupState, type SetupStatusResponse } from '@/features/setup/api'
import { SystemConnectionsPage } from '@/components/settings/pages/SystemConnections'
import { cn } from '@/lib/utils'

type WizardStep = 'welcome' | 'connections' | 'models' | 'finish'

const isAdminPayload = (
  payload: SetupStatusResponse | null,
): payload is Extract<SetupStatusResponse, { diagnostics: any }> =>
  Boolean(payload && 'diagnostics' in payload)

const StepBadge = ({ active, done, label }: { active: boolean; done: boolean; label: string }) => {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-full px-3 py-1 text-xs border',
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : done
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900'
            : 'bg-muted/40 text-muted-foreground border-border',
      )}
    >
      {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="h-2 w-2 rounded-full bg-current opacity-60" />}
      <span>{label}</span>
    </div>
  )
}

export function SetupWizard() {
  const router = useRouter()
  const { toast } = useToast()
  const { actorState, user } = useAuthStore((state) => ({
    actorState: state.actorState,
    user: state.user,
  }))
  const isAdmin = actorState === 'authenticated' && user?.role === 'ADMIN'

  const [status, setStatus] = useState<SetupStatusResponse | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [step, setStep] = useState<WizardStep>('welcome')
  const [manualOpen, setManualOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [skipConfirmOpen, setSkipConfirmOpen] = useState(false)

  const { models, isLoading: modelsLoading, fetchAll } = useModelsStore()

  const blocking = status?.setup_state === 'required'
  const open = blocking || manualOpen

  const adminStatus = useMemo(() => (isAdminPayload(status) ? status : null), [status])
  const canProceedConnections = Boolean(adminStatus?.diagnostics?.hasEnabledSystemConnection)
  const canProceedModels = Boolean(adminStatus?.diagnostics?.hasChatModels)
  const canComplete = Boolean(adminStatus?.can_complete)

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true)
    setStatusError(null)
    try {
      const res = await getSetupStatus()
      setStatus(res.data)
      return res.data
    } catch (error: any) {
      const msg = error?.response?.data?.error || error?.message || '获取引导状态失败'
      setStatusError(msg)
      return null
    } finally {
      setStatusLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshStatus().catch(() => {})
  }, [refreshStatus])

  useEffect(() => {
    if (!isAdmin) return
    refreshStatus().catch(() => {})
  }, [isAdmin, refreshStatus])

  useEffect(() => {
    if (!open) return
    if (!isAdmin) {
      setStep('welcome')
      return
    }
    if (step === 'welcome' && status?.setup_state === 'required') {
      // 保持在 welcome，由管理员点击开始
      return
    }
  }, [isAdmin, open, step, status?.setup_state])

  const openSettingsDialog = () => {
    try {
      window.dispatchEvent(new Event('aichat:open-settings'))
    } catch {}
  }

  const goLogin = () => {
    const next = encodeURIComponent('/main')
    router.push(`/auth/login?next=${next}`)
  }

  const handleStart = async () => {
    if (!isAdmin) return
    await refreshStatus()
    setStep('connections')
  }

  const handleRefreshModels = async () => {
    if (!isAdmin) return
    setBusy(true)
    try {
      await refreshModelCatalog()
      await fetchAll()
      await refreshStatus()
      toast({ title: '模型目录已刷新' })
    } catch (error: any) {
      toast({
        title: '刷新失败',
        description: error?.response?.data?.error || error?.message || '刷新模型目录失败',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  const handleSkip = async () => {
    if (!isAdmin) return
    setBusy(true)
    try {
      await setSetupState('skipped')
      await refreshStatus()
      setManualOpen(false)
      setStep('welcome')
      toast({
        title: '已跳过初始化向导',
        description: '未完成配置可能导致无法使用聊天/文档等功能，请尽快补齐连接与模型设置。',
        variant: 'destructive',
      })
    } catch (error: any) {
      toast({
        title: '跳过失败',
        description: error?.response?.data?.error || error?.message || '更新引导状态失败',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
      setSkipConfirmOpen(false)
    }
  }

  const handleComplete = async () => {
    if (!isAdmin) return
    if (!canComplete) {
      toast({
        title: '尚未满足完成条件',
        description: '请先配置至少一个启用的系统连接，并确保存在可用的对话模型。',
        variant: 'destructive',
      })
      return
    }
    setBusy(true)
    try {
      await setSetupState('completed')
      await refreshStatus()
      setManualOpen(false)
      setStep('welcome')
      toast({ title: '初始化向导已完成' })
    } catch (error: any) {
      toast({
        title: '完成失败',
        description: error?.response?.data?.error || error?.message || '更新引导状态失败',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  const overlayTitle = (() => {
    switch (step) {
      case 'connections':
        return '配置系统连接'
      case 'models':
        return '确认模型可用'
      case 'finish':
        return '完成初始化'
      default:
        return '欢迎使用 AIChat'
    }
  })()

  const overlayDesc = (() => {
    if (!isAdmin) return '需要管理员登录才能继续初始化。'
    switch (step) {
      case 'connections':
        return '添加至少一个系统级连接（OpenAI/Azure/Ollama/Google 等）。'
      case 'models':
        return '确保至少存在一个可用的对话模型（chat/both）。'
      case 'finish':
        return '检查安全项并完成初始化。'
      default:
        return '首次启动建议完成基础配置，以确保聊天功能可用。'
    }
  })()

  const steps = [
    { key: 'welcome' as const, label: '欢迎' },
    { key: 'connections' as const, label: '连接' },
    { key: 'models' as const, label: '模型' },
    { key: 'finish' as const, label: '完成' },
  ]

  const currentIndex = steps.findIndex((s) => s.key === step)

  const reminderVisible = status?.setup_state === 'skipped' && isAdmin

  return (
    <>
      {reminderVisible && (
        <div className="fixed bottom-4 left-4 z-[60] max-w-[min(520px,calc(100vw-2rem))]">
          <div className="rounded-xl border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 shadow-lg p-4 space-y-2">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-medium">你已跳过初始化向导</div>
                <div className="text-sm text-muted-foreground">
                  未完成配置可能导致模型列表为空或功能不可用。建议尽快补齐系统连接与模型设置。
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setManualOpen(true)
                  setStep('welcome')
                }}
              >
                继续引导
              </Button>
              <Button
                type="button"
                onClick={() => {
                  openSettingsDialog()
                }}
              >
                <Settings className="h-4 w-4 mr-2" />
                打开系统设置
              </Button>
            </div>
          </div>
        </div>
      )}

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && blocking) return
          setManualOpen(nextOpen)
          if (!nextOpen) {
            setStep('welcome')
          }
        }}
      >
        <DialogContent className="w-screen h-[100dvh] max-w-none border-0 p-0 shadow-none sm:w-[92vw] sm:h-[85vh] sm:max-h-[88vh] sm:max-w-6xl sm:border sm:rounded-2xl sm:shadow-2xl flex flex-col min-h-0 overflow-hidden bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
          <DialogHeader className="px-5 py-4 border-b">
            <DialogTitle className="text-base sm:text-lg">{overlayTitle}</DialogTitle>
            <DialogDescription className="text-sm">{overlayDesc}</DialogDescription>
          </DialogHeader>

          <div className="px-5 py-3 border-b bg-muted/20">
            <div className="flex flex-wrap gap-2">
              {steps.map((s, idx) => (
                <StepBadge
                  key={s.key}
                  label={s.label}
                  active={s.key === step}
                  done={idx < currentIndex}
                />
              ))}
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-auto p-5">
            {statusError && (
              <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {statusError}
              </div>
            )}

            {step === 'welcome' && (
              <div className="space-y-6">
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground">
                    这是首次启动引导流程：请先完成系统连接与模型配置，确保聊天功能可用。
                  </div>
                  {status?.setup_state === 'required' && (
                    <div className="text-sm">
                      <span className="inline-flex items-center gap-2 rounded-md bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300 px-3 py-2 border border-amber-200/70 dark:border-amber-900">
                        <AlertTriangle className="h-4 w-4" />
                        当前系统要求完成初始化后才能进入主界面
                      </span>
                    </div>
                  )}
                </div>

                {!isAdmin ? (
                  <div className="rounded-xl border p-5 space-y-3">
                    <div className="font-medium">需要管理员登录</div>
                    <div className="text-sm text-muted-foreground">
                      为保证安全，只有管理员可以继续初始化配置。若你不是管理员，请联系管理员完成设置。
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                      <Button type="button" onClick={goLogin}>
                        去管理员登录
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          openSettingsDialog()
                        }}
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        打开设置（登录后）
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border p-4">
                        <div className="text-xs text-muted-foreground">系统连接</div>
                        <div className="mt-1 text-lg font-semibold">
                          {adminStatus?.diagnostics.enabledSystemConnections ?? 0}
                          <span className="text-muted-foreground font-normal">
                            {' '}
                            / {adminStatus?.diagnostics.totalSystemConnections ?? 0}
                          </span>
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          需要至少 1 个启用的系统连接
                        </div>
                      </div>
                      <div className="rounded-xl border p-4">
                        <div className="text-xs text-muted-foreground">对话模型（chat/both）</div>
                        <div className="mt-1 text-lg font-semibold">
                          {adminStatus?.diagnostics.chatModels ?? 0}
                          <span className="text-muted-foreground font-normal">
                            {' '}
                            / {adminStatus?.diagnostics.totalModels ?? 0}
                          </span>
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          需要至少 1 个可用对话模型
                        </div>
                      </div>
                    </div>

                    {(adminStatus?.diagnostics.securityWarnings.jwtSecretUnsafe ||
                      adminStatus?.diagnostics.securityWarnings.encryptionKeyUnsafe) && (
                      <div className="rounded-xl border border-amber-200/70 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30 p-4 space-y-2">
                        <div className="font-medium flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-amber-600" />
                          安全提醒
                        </div>
                        <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
                          {adminStatus?.diagnostics.securityWarnings.jwtSecretUnsafe && (
                            <li>请设置强 `JWT_SECRET` 并重启后端（生产环境必做）</li>
                          )}
                          {adminStatus?.diagnostics.securityWarnings.encryptionKeyUnsafe && (
                            <li>请设置强 `ENCRYPTION_KEY` 并重启后端（用于加密存储 API Key）</li>
                          )}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {step === 'connections' && (
              <div className="space-y-4">
                {!isAdmin ? (
                  <div className="rounded-xl border p-5">
                    <div className="font-medium">需要管理员登录</div>
                    <div className="mt-2 text-sm text-muted-foreground">
                      请先登录管理员账号，再进行连接配置。
                    </div>
                    <div className="mt-4 flex justify-end">
                      <Button type="button" onClick={goLogin}>
                        去管理员登录
                      </Button>
                    </div>
                  </div>
                ) : (
                  <SystemConnectionsPage />
                )}
              </div>
            )}

            {step === 'models' && (
              <div className="space-y-4">
                {!isAdmin ? (
                  <div className="rounded-xl border p-5">
                    <div className="font-medium">需要管理员登录</div>
                    <div className="mt-2 text-sm text-muted-foreground">
                      请先登录管理员账号，再确认模型可用性。
                    </div>
                    <div className="mt-4 flex justify-end">
                      <Button type="button" onClick={goLogin}>
                        去管理员登录
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="font-medium">模型目录状态</div>
                        <div className="text-sm text-muted-foreground">
                          若新增连接后模型未出现，可手动刷新模型目录。
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button type="button" variant="outline" onClick={() => fetchAll()} disabled={modelsLoading}>
                          {modelsLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                          刷新列表
                        </Button>
                        <Button type="button" onClick={handleRefreshModels} disabled={busy}>
                          {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                          刷新模型目录
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border p-4">
                        <div className="text-xs text-muted-foreground">总模型数</div>
                        <div className="mt-1 text-lg font-semibold">
                          {adminStatus?.diagnostics.totalModels ?? 0}
                        </div>
                      </div>
                      <div className="rounded-xl border p-4">
                        <div className="text-xs text-muted-foreground">对话模型（chat/both）</div>
                        <div className="mt-1 text-lg font-semibold">
                          {adminStatus?.diagnostics.chatModels ?? 0}
                        </div>
                      </div>
                    </div>

                    <Separator />

                    <div className="space-y-2">
                      <div className="font-medium">当前模型列表（前 12 条）</div>
                      <div className="text-sm text-muted-foreground">
                        仅用于确认是否能拉到模型；更细粒度管理请在系统设置中操作。
                      </div>
                      <div className="rounded-xl border overflow-hidden">
                        <div className="max-h-[360px] overflow-auto">
                          {modelsLoading && models.length === 0 ? (
                            <div className="p-4 text-sm text-muted-foreground flex items-center gap-2">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              正在加载模型…
                            </div>
                          ) : models.length === 0 ? (
                            <div className="p-4 text-sm text-muted-foreground">
                              暂无模型。请先配置连接并刷新模型目录。
                            </div>
                          ) : (
                            <ul className="divide-y">
                              {models.slice(0, 12).map((m) => (
                                <li key={`${m.connectionId}:${m.id}`} className="px-4 py-3">
                                  <div className="text-sm font-medium break-all">{m.name || m.id}</div>
                                  <div className="text-xs text-muted-foreground break-all">
                                    {m.channelName} · {m.provider} · {m.modelType || 'chat'}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {step === 'finish' && (
              <div className="space-y-4">
                {!isAdmin ? (
                  <div className="rounded-xl border p-5">
                    <div className="font-medium">需要管理员登录</div>
                    <div className="mt-2 text-sm text-muted-foreground">
                      请先登录管理员账号，再完成初始化。
                    </div>
                    <div className="mt-4 flex justify-end">
                      <Button type="button" onClick={goLogin}>
                        去管理员登录
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="rounded-xl border p-4 space-y-2">
                      <div className="font-medium">完成条件</div>
                      <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
                        <li>至少 1 个启用的系统连接</li>
                        <li>至少 1 个可用对话模型（chat/both）</li>
                      </ul>
                      {!canComplete && (
                        <div className="mt-3 text-sm text-amber-700 dark:text-amber-300 flex items-start gap-2">
                          <AlertTriangle className="h-4 w-4 mt-0.5" />
                          <span>
                            当前尚未满足完成条件，请返回上一步补齐配置；或选择“跳过”稍后再配。
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border p-4 space-y-2">
                      <div className="font-medium">安全检查（建议）</div>
                      <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
                        <li>
                          {adminStatus?.diagnostics.securityWarnings.jwtSecretUnsafe ? (
                            <span className="text-amber-700 dark:text-amber-300">JWT_SECRET 未设置或疑似弱值（需处理）</span>
                          ) : (
                            <span>JWT_SECRET 已设置</span>
                          )}
                        </li>
                        <li>
                          {adminStatus?.diagnostics.securityWarnings.encryptionKeyUnsafe ? (
                            <span className="text-amber-700 dark:text-amber-300">ENCRYPTION_KEY 未设置或疑似弱值（需处理）</span>
                          ) : (
                            <span>ENCRYPTION_KEY 已设置</span>
                          )}
                        </li>
                      </ul>
                      <div className="text-sm text-muted-foreground">
                        提示：这两项是环境变量，修改后需要重启后端/容器生效。
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="border-t p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between bg-background">
            <div className="text-xs text-muted-foreground">
              {statusLoading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  正在同步引导状态…
                </span>
              ) : (
                <span>
                  当前引导状态：<span className="font-medium">{status?.setup_state || 'unknown'}</span>
                </span>
              )}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              {isAdmin && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSkipConfirmOpen(true)}
                  disabled={busy}
                >
                  跳过
                </Button>
              )}

              {step === 'welcome' && (
                <Button type="button" onClick={handleStart} disabled={!isAdmin || statusLoading}>
                  开始设置
                </Button>
              )}

              {step === 'connections' && (
                <>
                  <Button type="button" variant="outline" onClick={() => setStep('welcome')}>
                    上一步
                  </Button>
                  <Button type="button" onClick={async () => { await refreshStatus() }} disabled={statusLoading}>
                    重新检查
                  </Button>
                  <Button
                    type="button"
                    onClick={async () => {
                      const latest = await refreshStatus()
                      const latestAdmin = isAdminPayload(latest) ? latest : null
                      if (latestAdmin?.diagnostics.hasEnabledSystemConnection) {
                        setStep('models')
                        return
                      }
                      {
                        toast({
                          title: '仍缺少系统连接',
                          description: '请先新增并启用至少一个系统连接。',
                          variant: 'destructive',
                        })
                      }
                    }}
                    disabled={!isAdmin || statusLoading}
                  >
                    下一步
                  </Button>
                </>
              )}

              {step === 'models' && (
                <>
                  <Button type="button" variant="outline" onClick={() => setStep('connections')}>
                    上一步
                  </Button>
                  <Button type="button" onClick={async () => { await refreshStatus() }} disabled={statusLoading}>
                    重新检查
                  </Button>
                  <Button
                    type="button"
                    onClick={async () => {
                      const latest = await refreshStatus()
                      const latestAdmin = isAdminPayload(latest) ? latest : null
                      if (latestAdmin?.diagnostics.hasChatModels) {
                        setStep('finish')
                        return
                      }
                      {
                        toast({
                          title: '仍缺少对话模型',
                          description: '请确保至少存在 1 个 chat/both 类型模型（可尝试刷新模型目录）。',
                          variant: 'destructive',
                        })
                      }
                    }}
                    disabled={!isAdmin || statusLoading}
                  >
                    下一步
                  </Button>
                </>
              )}

              {step === 'finish' && (
                <>
                  <Button type="button" variant="outline" onClick={() => setStep('models')}>
                    上一步
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      openSettingsDialog()
                    }}
                  >
                    打开系统设置
                  </Button>
                  <Button type="button" onClick={handleComplete} disabled={!isAdmin || busy}>
                    完成并进入系统
                  </Button>
                </>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={skipConfirmOpen} onOpenChange={setSkipConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>跳过初始化向导？</AlertDialogTitle>
            <AlertDialogDescription>
              跳过后所有用户都将直接进入系统，但未完成配置可能导致无法聊天、模型列表为空、文档解析不可用等问题。
              建议仅在你确认稍后会继续配置时再跳过。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button variant="destructive" onClick={handleSkip} disabled={busy}>
                仍然跳过
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default SetupWizard
