"use client"
import { useState } from "react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { apiClient } from "@/lib/api"

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
    <div className="p-4 space-y-6">
      <div className="text-base font-medium">账号安全</div>
      <form onSubmit={onSubmit} className="space-y-4 max-w-md">
        <div className="space-y-2">
          <Label htmlFor="currentPassword">当前密码</Label>
          <Input id="currentPassword" type="password" value={currentPassword} onChange={(e)=>setCurrentPassword(e.target.value)} required disabled={submitting} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="newPassword">新密码</Label>
          <Input id="newPassword" type="password" value={newPassword} onChange={(e)=>setNewPassword(e.target.value)} required disabled={submitting} />
          <p className="text-xs text-muted-foreground">至少 8 位，且包含字母与数字</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">确认新密码</Label>
          <Input id="confirmPassword" type="password" value={confirmPassword} onChange={(e)=>setConfirmPassword(e.target.value)} required disabled={submitting} />
        </div>
        {error && <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">{error}</div>}
        <Button type="submit" disabled={submitting} className="w-28">{submitting ? '保存中...' : '保存'}</Button>
      </form>
    </div>
  )
}

