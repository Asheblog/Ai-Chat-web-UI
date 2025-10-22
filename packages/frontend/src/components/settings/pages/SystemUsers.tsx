"use client"
import { Users } from "lucide-react"

export function SystemUsersPage(){
  return (
    <section className="rounded-xl border overflow-hidden">
      <div className="px-4 py-3 font-medium border-b">用户管理</div>
      <div className="p-6 text-center text-muted-foreground">
        <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>用户管理功能正在开发中</p>
        <p className="text-sm">即将支持用户列表、角色管理等功能</p>
      </div>
    </section>
  )
}

