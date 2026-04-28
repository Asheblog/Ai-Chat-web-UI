'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, Lock, User } from 'lucide-react'
import { AuthFormLayout } from '@/components/auth-form-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { useAuthStore } from '@/store/auth-store'
import { useSettingsStore } from '@/store/settings-store'
import { extractErrorMessage } from '@/lib/utils'

interface LoginPageClientProps {
  initialBrandText?: string | null
}

export function LoginPageClient({ initialBrandText }: LoginPageClientProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [rememberLogin, setRememberLogin] = useState(true)
  const [savePassword, setSavePassword] = useState(false)
  const [passwordVisible, setPasswordVisible] = useState(false)

  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectedRef = useRef<string | null>(null)
  const { login, user, error, clearError } = useAuthStore()
  const { systemSettings, publicBrandText, bootstrapBrandText } = useSettingsStore((state) => ({
    systemSettings: state.systemSettings,
    publicBrandText: state.publicBrandText,
    bootstrapBrandText: state.bootstrapBrandText,
  }))
  const errorMessage = error ? extractErrorMessage(error) : null
  const brandText = (systemSettings?.brandText ?? publicBrandText ?? initialBrandText ?? '').trim() || 'AIChat'

  const nextPath = (() => {
    const raw = searchParams?.get('next')
    if (!raw) return '/main'
    const trimmed = raw.trim()
    if (!trimmed.startsWith('/')) return '/main'
    if (trimmed.startsWith('//')) return '/main'
    if (trimmed.includes('://')) return '/main'
    return trimmed
  })()

  useEffect(() => {
    if (initialBrandText) {
      bootstrapBrandText(initialBrandText)
    }
  }, [initialBrandText, bootstrapBrandText])

  useEffect(() => {
    if (!user) {
      redirectedRef.current = null
      return
    }
    if (redirectedRef.current === nextPath) return
    redirectedRef.current = nextPath
    router.replace(nextPath)
  }, [nextPath, user, router])

  useEffect(() => {
    clearError()
    // 从本地偏好加载设置与可能保存的账号
    try {
      const prefRaw = localStorage.getItem('auth_pref')
      if (prefRaw) {
        const pref = JSON.parse(prefRaw) as { rememberLogin?: boolean; savePassword?: boolean }
        if (typeof pref.rememberLogin === 'boolean') setRememberLogin(pref.rememberLogin)
        if (typeof pref.savePassword === 'boolean') setSavePassword(pref.savePassword)
      }
      const savedRaw = localStorage.getItem('auth_saved')
      if (savedRaw) {
        const saved = JSON.parse(savedRaw) as { username?: string; password?: string }
        if (saved.username) setUsername(saved.username)
        if (saved.password && (prefRaw ? JSON.parse(prefRaw).savePassword : false)) {
          setPassword(saved.password)
        }
      }
    } catch { }
  }, [clearError])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !password) return

    setIsLoading(true)
    clearError()

    try {
      // 保存偏好
      try {
        localStorage.setItem('auth_pref', JSON.stringify({ rememberLogin, savePassword }))
        if (savePassword) {
          localStorage.setItem('auth_saved', JSON.stringify({ username, password }))
        } else {
          localStorage.removeItem('auth_saved')
        }
      } catch { }

      await login(username, password)
    } catch (error) {
      // 错误已经在store中处理
      console.error('Login failed:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <AuthFormLayout
      title={`欢迎登录 ${brandText}`}
      description="登录账号以继续使用"
      error={
        errorMessage ? (
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {errorMessage}
          </span>
        ) : null
      }
      footer={
        <>
          <div>
            还没有账户？{' '}
            <Link href="/auth/register" className="text-primary hover:text-[hsl(var(--primary-hover))] hover:underline">立即注册</Link>
          </div>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="username" className="text-sm font-medium text-foreground">用户名</Label>
          <div className="relative">
            <User className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
            <Input
              id="username"
              type="text"
              placeholder="请输入用户名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              disabled={isLoading}
              className="h-12 rounded-[8px] bg-card pl-12"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="password" className="text-sm font-medium text-foreground">密码</Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
            <Input
              id="password"
              type={passwordVisible ? 'text' : 'password'}
              placeholder="请输入密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isLoading}
              className="h-12 rounded-[8px] bg-card pl-12 pr-12"
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
              onClick={() => setPasswordVisible((value) => !value)}
              aria-label={passwordVisible ? '隐藏密码' : '显示密码'}
              disabled={isLoading}
            >
              {passwordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <Checkbox id="rememberLogin" checked={rememberLogin} onChange={(e) => setRememberLogin(e.currentTarget.checked)} />
            <span>记住登录</span>
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <Checkbox id="savePassword" checked={savePassword} onChange={(e) => setSavePassword(e.currentTarget.checked)} />
            <span>保存密码</span>
          </label>
        </div>
        <Button
          type="submit"
          className="h-12 w-full rounded-[8px] text-base shadow-[0_12px_24px_rgba(37,99,235,0.22)]"
          disabled={isLoading || !username || !password}
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              正在登录...
            </>
          ) : (
            <>
              登录
              <ArrowRight className="ml-3 h-5 w-5" />
            </>
          )}
        </Button>
      </form>
    </AuthFormLayout>
  )
}

export default LoginPageClient
