"use client"
import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { changePassword } from '@/features/auth/api'
import { AlertCircle, Check, ChevronDown, Loader2, Lock } from 'lucide-react'
import { SettingRow } from '../components/setting-row'
import { cn } from '@/lib/utils'

export function PersonalSecurityPage() {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const validate = () => {
    // 与后端校验规则保持一致：至少8位且包含字母与数字
    const strong = newPassword.length >= 8 && /[a-zA-Z]/.test(newPassword) && /[0-9]/.test(newPassword)
    if (!currentPassword) return "请填写当前密码"
    if (!newPassword) return "请填写新密码"
    if (!strong) return "新密码至少8位，且包含字母与数字"
    if (newPassword !== confirmPassword) return "两次输入的新密码不一致"
    if (newPassword === currentPassword) return "新密码不能与当前密码相同"
    return null
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const msg = validate()
    if (msg) { setError(msg); return }
    setSubmitting(true); setError(null)
    try {
      await changePassword(currentPassword, newPassword)
      toast({ title: '密码已更新' })
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("")
    } catch (e: any) {
      const emsg = e?.response?.data?.error || e?.message || '修改密码失败'
      setError(emsg)
    } finally { setSubmitting(false) }
  }

  return (
    <section className="v2-panel overflow-hidden bg-white/90 shadow-none">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-blue-50/45 sm:px-6"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-blue-50 text-slate-700 ring-1 ring-blue-100">
            <Lock className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-900">安全设置（密码与登录）</span>
            <span className="mt-0.5 block text-xs text-slate-500">修改密码、管理登录设备等</span>
          </span>
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200',
            open ? 'rotate-180' : ''
          )}
        />
      </button>

      {open ? (
        <div className="border-t border-slate-200/80 px-5 py-5 sm:px-6">
          <div className="mb-4">
            <h2 className="v2-section-title">修改密码</h2>
            <p className="v2-muted-line mt-1">提交后立即更新账号密码，请使用包含字母与数字的新密码。</p>
          </div>

          <form onSubmit={onSubmit} className="space-y-3">
            <SettingRow
              title="当前密码"
              description="用于验证当前身份，请输入正在使用的密码"
              align="start"
            >
              <Input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e)=>setCurrentPassword(e.target.value)}
                required
                disabled={submitting}
                placeholder="请输入当前密码"
                className="w-full sm:w-[320px]"
              />
            </SettingRow>

            <SettingRow
              title="新密码"
              description="至少 8 位，并包含字母与数字"
              align="start"
            >
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e)=>setNewPassword(e.target.value)}
                required
                disabled={submitting}
                placeholder="至少8位，且包含字母与数字"
                className="w-full sm:w-[320px]"
              />
            </SettingRow>

            <SettingRow
              title="确认新密码"
              description="再次输入，确保没有输入错误"
              align="start"
            >
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e)=>setConfirmPassword(e.target.value)}
                required
                disabled={submitting}
                placeholder="再次输入新密码"
                className="w-full sm:w-[320px]"
              />
            </SettingRow>

            {error && (
              <div className="flex items-start gap-2 rounded-[10px] border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <SettingRow
              title="保存更改"
              description="提交后立即更新您的账号密码"
            >
              <Button type="submit" disabled={submitting} className="w-full justify-center sm:w-[200px]">
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    保存中...
                  </>
                ) : (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    保存更改
                  </>
                )}
              </Button>
            </SettingRow>
          </form>
        </div>
      ) : null}
    </section>
  )
}
