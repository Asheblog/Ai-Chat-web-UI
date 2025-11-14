"use client"
import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { CardTitle, CardDescription } from "@/components/ui/card"
import { apiClient } from "@/lib/api"
import { Lock, Check } from "lucide-react"
import { SettingRow } from "../components/setting-row"

export function PersonalSecurityPage() {
  const { toast } = useToast()
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
      await apiClient.changePassword(currentPassword, newPassword)
      toast({ title: '密码已更新' })
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("")
    } catch (e: any) {
      const emsg = e?.response?.data?.error || e?.message || '修改密码失败'
      setError(emsg)
    } finally { setSubmitting(false) }
  }

  return (
    <div className="space-y-6">

      {/* 修改密码区块 */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b">
          <Lock className="w-5 h-5 text-primary" />
          <div>
            <CardTitle className="text-lg">修改密码</CardTitle>
            <CardDescription>定期更新密码以保护账户安全</CardDescription>
          </div>
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
            <div className="text-sm text-destructive bg-destructive/10 px-4 py-3 rounded-lg border border-destructive/20">
              {error}
            </div>
          )}

          <SettingRow
            title="保存更改"
            description="提交后立即更新您的账号密码"
          >
            <Button type="submit" disabled={submitting} className="w-full sm:w-[200px] justify-center">
              {submitting ? (
                '保存中...'
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  保存更改
                </>
              )}
            </Button>
          </SettingRow>
        </form>
      </div>
    </div>
  )
}
