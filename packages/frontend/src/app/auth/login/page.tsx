'use client'
export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/store/auth-store'
import { extractErrorMessage } from '@/lib/utils'
import { Checkbox } from '@/components/ui/checkbox'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [rememberLogin, setRememberLogin] = useState(true)
  const [savePassword, setSavePassword] = useState(false)

  const router = useRouter()
  const { login, user, error, clearError } = useAuthStore()

  useEffect(() => {
    if (user) {
      router.replace('/main')
    }
  }, [user, router])

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
    } catch {}
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
      } catch {}

      await login(username, password)
      router.replace('/main')
    } catch (error) {
      // 错误已经在store中处理
      console.error('Login failed:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl font-bold">AI聊天平台</CardTitle>
        <CardDescription>
          登录您的账户开始对话
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">用户名</Label>
            <Input
              id="username"
              type="text"
              placeholder="请输入用户名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              disabled={isLoading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              type="password"
              placeholder="请输入密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isLoading}
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
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
              {extractErrorMessage(error)}
            </div>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={isLoading || !username || !password}
          >
            {isLoading ? '登录中...' : '登录'}
          </Button>
        </form>
        <div className="mt-6 text-center text-sm space-y-2">
          <div>
            还没有账户？{' '}
            <Link href="/auth/register" className="text-primary hover:underline">立即注册</Link>
          </div>
          <div className="text-muted-foreground">
            <button
              type="button"
              className="underline hover:text-foreground"
              onClick={() => { try { document.cookie = `viewMode=mobile; Path=/; Max-Age=${60*60*24*30}; SameSite=Lax` } catch {}; window.location.href = '/m/auth/login' }}
            >
              使用移动版
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
