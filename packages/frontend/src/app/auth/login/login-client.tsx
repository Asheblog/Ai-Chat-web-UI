'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
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

  const router = useRouter()
  const searchParams = useSearchParams()
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
    if (user) {
      router.replace(nextPath)
    }
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
      title={`${brandText} 登录`}
      description="使用你的账号继续当前对话与配置。"
      error={errorMessage}
      footer={
        <>
          <div>
            还没有账户？{' '}
            <Link href="/auth/register" className="text-primary hover:text-[hsl(var(--primary-hover))] hover:underline">立即注册</Link>
          </div>
          <div>界面已适配桌面与移动端。</div>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="username" className="text-xs uppercase tracking-[0.08em] text-muted-foreground">用户名</Label>
          <Input
            id="username"
            type="text"
            placeholder="请输入用户名"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            disabled={isLoading}
            className="h-11"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password" className="text-xs uppercase tracking-[0.08em] text-muted-foreground">密码</Label>
          <Input
            id="password"
            type="password"
            placeholder="请输入密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={isLoading}
            className="h-11"
          />
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
          className="h-11 w-full"
          disabled={isLoading || !username || !password}
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              正在登录...
            </>
          ) : (
            '登录'
          )}
        </Button>
      </form>
    </AuthFormLayout>
  )
}

export default LoginPageClient
