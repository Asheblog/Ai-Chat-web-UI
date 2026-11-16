"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/use-toast"

export interface KnowledgeBaseCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (input: { name: string; description?: string }) => Promise<void>
}

export function KnowledgeBaseCreateDialog({
  open,
  onOpenChange,
  onCreate,
}: KnowledgeBaseCreateDialogProps) {
  const { toast } = useToast()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [creating, setCreating] = useState(false)

  const handleCreate = async () => {
    if (!name.trim()) {
      toast({ title: "请输入知识库名称", variant: "destructive" })
      return
    }
    setCreating(true)
    try {
      await onCreate({ name: name.trim(), description: description.trim() || undefined })
      toast({ title: "知识库创建成功" })
      onOpenChange(false)
      setName("")
      setDescription("")
    } catch (error) {
      toast({
        title: "创建失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建知识库</DialogTitle>
          <DialogDescription>创建后可以向其中上传文档，供聊天检索。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="new-kb-name">
              名称
            </label>
            <Input
              id="new-kb-name"
              placeholder="输入知识库名称"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="new-kb-description">
              描述（可选）
            </label>
            <Input
              id="new-kb-description"
              placeholder="输入知识库描述"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? "创建中..." : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
