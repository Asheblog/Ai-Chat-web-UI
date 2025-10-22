"use client"
import { Users } from "lucide-react"

export function SystemUsersPage(){
  return (
    <div className="p-4 space-y-6">
      <div className="text-base font-medium">用户管理</div>
      <div className="text-center text-muted-foreground py-8">
        <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>用户管理功能正在开发中</p>
        <p className="text-sm">即将支持用户列表、角色管理等功能</p>
      </div>
    </div>
  )
}
