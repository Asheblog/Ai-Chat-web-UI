'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/store/auth-store'
import { extractErrorMessage } from '@/lib/utils'

function setViewMode(mode: 'mobile'|'desktop') {
  try {
    document.cookie = `viewMode=${mode}; Path=/; Max-Age=${60*60*24*30}; SameSite=Lax`
  } catch {}
}

export default function MobileRegisterPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const router = useRouter()
  const { register, user, error, clearError } = useAuthStore()

  useEffect(() => { if (user) router.replace('/m/main') }, [user, router])
  useEffect(() => { clearError() }, [clearError])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !password || !confirmPassword) return
    if (password !== confirmPassword || password.length < 6) return
    setIsLoading(true)
    clearError()
    try {
      await register(username, password)
      router.replace('/m/main')
    } catch (error) {
      console.error('Registration failed:', error)
    } finally { setIsLoading(false) }
  }

  const passwordError = (() => {
    if (password && confirmPassword && password !== confirmPassword) return '两次输入的密码不一致'
    if (password && password.length < 6) return '密码长度至少为6位'
    return null
  })()
  const isValid = username && password && confirmPassword && !passwordError && password === confirmPassword

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-muted/30">
      <div className="w-full max-w-sm">
        <Card className="rounded-3xl shadow-xl">
          <CardHeader className="text-center space-y-1">
            <CardTitle className="text-2xl font-semibold">AI聊天平台</CardTitle>
            <CardDescription>创建新账户开始对话</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="username">用户名</Label>
                <Input id="username" type="text" placeholder="请输入用户名" value={username} onChange={(e)=>setUsername(e.target.value)} required disabled={isLoading} minLength={3} className="rounded-xl" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">密码</Label>
                <Input id="password" type="password" placeholder="请输入密码（至少6位）" value={password} onChange={(e)=>setPassword(e.target.value)} required disabled={isLoading} minLength={6} className="rounded-xl" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">确认密码</Label>
                <Input id="confirmPassword" type="password" placeholder="请再次输入密码" value={confirmPassword} onChange={(e)=>setConfirmPassword(e.target.value)} required disabled={isLoading} className="rounded-xl" />
                {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}
              </div>
              {error && (
                <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                  {extractErrorMessage(error)}
                </div>
              )}
              <Button type="submit" className="w-full rounded-full" disabled={isLoading || !isValid}>
                {isLoading ? '注册中...' : '注册'}
              </Button>
            </form>
            <div className="mt-6 text-center text-sm space-y-2">
              <div>
                已有账户？{' '}
                <Link href="/m/auth/login" className="text-primary hover:underline">立即登录</Link>
              </div>
              <div className="text-muted-foreground">
                <button className="underline hover:text-foreground" onClick={()=>{ setViewMode('desktop'); window.location.href='/auth/register' }}>切换到桌面版</button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

