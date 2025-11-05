'use client'
export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AuthFormLayout } from '@/components/auth-form-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthStore } from '@/store/auth-store'
import { extractErrorMessage } from '@/lib/utils'

export default function RegisterPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const router = useRouter()
  const { register, user, error, clearError } = useAuthStore()
  const errorMessage = error ? extractErrorMessage(error) : null

  useEffect(() => {
    if (user) {
      router.replace('/main')
    }
  }, [user, router])

  useEffect(() => {
    clearError()
  }, [clearError])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !password || !confirmPassword) return

    if (password !== confirmPassword) {
      return
    }

    setIsLoading(true)
    clearError()
    setSuccessMessage(null)

    try {
      const result = await register(username, password)
      if (result.token) {
        router.replace('/main')
        return
      }
      setSuccessMessage('注册申请已提交，请等待管理员审批通知后再登录。')
      setUsername('')
      setPassword('')
      setConfirmPassword('')
    } catch (error) {
      console.error('Registration failed:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const getPasswordError = () => {
    if (password && confirmPassword && password !== confirmPassword) {
      return '两次输入的密码不一致'
    }
    if (password && password.length < 6) {
      return '密码长度至少为6位'
    }
    return null
  }

  const passwordError = getPasswordError()
  const isValid = username && password && confirmPassword && !passwordError && password === confirmPassword

  return (
    <AuthFormLayout
      title="AI聊天平台"
      description="创建新账户开始对话"
      error={errorMessage}
      footer={
        <>
          <div>
            已有账户？{' '}
            <Link href="/auth/login" className="text-primary hover:underline">立即登录</Link>
          </div>
          <div className="text-muted-foreground">界面已自适应移动端，无需切换。</div>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {successMessage && (
          <div className="text-sm text-emerald-600 bg-emerald-100/60 border border-emerald-200 rounded px-3 py-2">
            {successMessage}
          </div>
        )}
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
            minLength={3}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">密码</Label>
          <Input
            id="password"
            type="password"
            placeholder="请输入密码（至少6位）"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={isLoading}
            minLength={6}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">确认密码</Label>
          <Input
            id="confirmPassword"
            type="password"
            placeholder="请再次输入密码"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            disabled={isLoading}
          />
          {passwordError && (
            <p className="text-sm text-destructive">{passwordError}</p>
          )}
        </div>
        <Button
          type="submit"
          className="w-full"
          disabled={isLoading || !isValid}
        >
          {isLoading ? '注册中...' : '注册'}
        </Button>
      </form>
    </AuthFormLayout>
  )
}
