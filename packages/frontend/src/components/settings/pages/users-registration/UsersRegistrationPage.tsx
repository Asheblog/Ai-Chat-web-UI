"use client"

import { useEffect } from "react"
import { UserPlus, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CardDescription, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useSystemSettings } from "@/hooks/use-system-settings"
import { RegistrationPolicyCard } from "./registration-policy-card"
import { SystemUsersPage } from "../SystemUsers"

/**
 * 用户与注册页：页壳（单一 useSystemSettings + 共享骨架/错误重试），
 * 上分区「注册策略」FeatureCard（allowRegistration/anonymousDailyQuota/defaultUserDailyQuota），
 * 下分区「用户管理」原样内嵌 SystemUsersPage（自身状态自管）。
 */
export function UsersRegistrationPage() {
  const {
    settings,
    refresh: fetchSystemSettings,
    update: updateSystemSettings,
    isLoading,
    error,
  } = useSystemSettings()

  useEffect(() => {
    fetchSystemSettings().catch(() => {})
  }, [fetchSystemSettings])

  if (isLoading && !settings) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <p>{error || "无法加载系统设置"}</p>
        <Button variant="outline" className="mt-3" onClick={() => fetchSystemSettings()}>
          重试
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* 页头 */}
      <div className="flex items-center gap-3 pb-3 border-b border-border/60">
        <UserPlus className="w-5 h-5 text-primary flex-shrink-0" />
        <div className="space-y-1">
          <CardTitle>用户与注册</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            注册开放策略、每日额度与用户管理
          </CardDescription>
        </div>
      </div>

      {/* 分区一：注册策略 */}
      <RegistrationPolicyCard
        settings={settings}
        update={updateSystemSettings}
        refresh={fetchSystemSettings}
      />

      {/* 分区二：用户管理（原样内嵌 SystemUsersPage，状态自管） */}
      <section aria-label="用户管理" data-card-key="users-registration:users">
        <div className="mb-4 flex items-start gap-3 border-b border-border/70 pb-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Users className="h-5 w-5" />
          </span>
          <div>
            <h2 className="v2-section-title">用户管理</h2>
            <p className="v2-muted-line mt-1">审批注册、管理账号状态，调整角色与每日额度。</p>
          </div>
        </div>
        <SystemUsersPage />
      </section>
    </div>
  )
}
