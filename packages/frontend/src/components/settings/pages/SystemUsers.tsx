"use client"
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { apiClient } from "@/lib/api"
import { useToast } from "@/components/ui/use-toast"

type UserRow = { id: number; username: string; role: 'ADMIN'|'USER'; createdAt: string; _count?: { chatSessions: number; connections: number } }
type PageData = { users: UserRow[]; pagination: { page: number; limit: number; total: number; totalPages: number } }

export function SystemUsersPage(){
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<UserRow[]>([])
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [totalPages, setTotalPages] = useState(1)
  const [search, setSearch] = useState("")
  const [searchDraft, setSearchDraft] = useState("")

  const load = async (opts?: { page?: number; limit?: number; search?: string }) => {
    setLoading(true); setError(null)
    try {
      const res = await apiClient.getUsers({ page: opts?.page ?? page, limit: opts?.limit ?? limit, search: typeof opts?.search==='string' ? opts?.search : search })
      const data = res?.data as PageData | undefined
      setRows(data?.users || [])
      if (data?.pagination) {
        setPage(data.pagination.page)
        setLimit(data.pagination.limit)
        setTotalPages(data.pagination.totalPages)
      }
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || '加载失败')
    } finally { setLoading(false) }
  }

  useEffect(() => { load() // 初次加载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onSearch = () => { setPage(1); setSearch(searchDraft); load({ page: 1, search: searchDraft }) }
  const onClearSearch = () => { setSearchDraft(""); setSearch(""); setPage(1); load({ page: 1, search: '' }) }

  const changeRole = async (row: UserRow, role: 'ADMIN'|'USER') => {
    if (!confirm(`确认将用户 “${row.username}” 角色变更为 ${role}?`)) return
    try {
      await apiClient.updateUserRole(row.id, role)
      toast({ title: '已更新用户角色' })
      await load()
    } catch (e:any) {
      toast({ title: '更新失败', description: e?.response?.data?.error || e?.message || '更新失败', variant: 'destructive' })
    }
  }

  const deleteUser = async (row: UserRow) => {
    if (!confirm(`确认删除用户 “${row.username}”? 该操作不可恢复，将级联删除其会话/消息。`)) return
    try {
      await apiClient.deleteUser(row.id)
      toast({ title: '已删除用户' })
      // 若当前页为空则回退一页
      await load()
    } catch (e:any) {
      toast({ title: '删除失败', description: e?.response?.data?.error || e?.message || '删除失败', variant: 'destructive' })
    }
  }

  const pagination = useMemo(() => ({ page, limit, totalPages }), [page, limit, totalPages])

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-base font-medium">用户管理</div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
          <Input placeholder="搜索用户名" value={searchDraft} onChange={(e)=>setSearchDraft(e.target.value)} className="w-full sm:w-56" onKeyDown={(e)=>{ if(e.key==='Enter') onSearch() }} />
          <Button variant="outline" onClick={onSearch} disabled={loading} className="w-full sm:w-auto">搜索</Button>
          {search && <Button variant="ghost" onClick={onClearSearch} disabled={loading} className="w-full sm:w-auto">清空</Button>}
          <Button variant="outline" onClick={()=>load()} disabled={loading} className="w-full sm:w-auto">刷新</Button>
        </div>
      </div>

      {error && <div className="text-sm text-destructive">{error}</div>}

      <div className="border rounded overflow-x-auto">
        <Table className="min-w-[720px]">
          <TableHeader>
            <TableRow>
              <TableHead>用户名</TableHead>
              <TableHead>角色</TableHead>
              <TableHead>会话数</TableHead>
              <TableHead>连接数</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && rows.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">加载中...</TableCell></TableRow>
            )}
            {!loading && rows.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">暂无数据</TableCell></TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.username}</TableCell>
                <TableCell>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${r.role==='ADMIN' ? 'bg-amber-100/30 border-amber-300 text-amber-700' : 'bg-muted/40 border-muted-foreground/20 text-muted-foreground'}`}>{r.role}</span>
                </TableCell>
                <TableCell>{r._count?.chatSessions ?? '-'}</TableCell>
                <TableCell>{r._count?.connections ?? '-'}</TableCell>
                <TableCell>{new Date(r.createdAt).toLocaleString()}</TableCell>
                <TableCell className="text-right">
                  <div className="flex flex-wrap justify-end gap-2">
                    {r.role !== 'ADMIN' && (
                      <Button size="sm" variant="outline" onClick={()=>changeRole(r, 'ADMIN')} className="w-full sm:w-auto">设为管理员</Button>
                    )}
                    {r.role !== 'USER' && (
                      <Button size="sm" variant="outline" onClick={()=>changeRole(r, 'USER')} className="w-full sm:w-auto">设为用户</Button>
                    )}
                    <Button size="sm" variant="destructive" onClick={()=>deleteUser(r)} className="w-full sm:w-auto">删除</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-sm">
        <div className="text-muted-foreground">第 {pagination.page} / {pagination.totalPages} 页</div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-2">
            <Button variant="outline" size="sm" disabled={page<=1 || loading} onClick={()=>{ const p=Math.max(1,page-1); setPage(p); load({ page: p }) }} className="w-full sm:w-auto">上一页</Button>
            <Button variant="outline" size="sm" disabled={page>=totalPages || loading} onClick={()=>{ const p=Math.min(totalPages,page+1); setPage(p); load({ page: p }) }} className="w-full sm:w-auto">下一页</Button>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-muted-foreground">每页</Label>
            <select className="border rounded px-2 py-1" value={limit} onChange={(e)=>{ const l = parseInt(e.target.value)||10; setLimit(l); setPage(1); load({ page:1, limit:l }) }}>
              {[10,20,50].map(n => (<option key={n} value={n}>{n}</option>))}
            </select>
          </div>
        </div>
      </div>
    </div>
  )
}
