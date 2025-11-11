'use client'
import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { useAuthStore } from "@/store/auth-store"

export default function SystemSettingsIndexPage() {
  const router = useRouter()
  const { user, actorState } = useAuthStore((state) => ({
    user: state.user,
    actorState: state.actorState,
  }))

  useEffect(() => {
    if (actorState === "loading") return
    const isAdmin = actorState === "authenticated" && user?.role === "ADMIN"
    if (!isAdmin) {
      router.replace("/main/settings/personal")
      return
    }
    router.replace("/main/settings/system/general")
  }, [actorState, router, user?.role])

  return (
    <div className="flex h-full min-h-[240px] flex-1 items-center justify-center text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      正在跳转到对应的系统设置分区…
    </div>
  )
}
