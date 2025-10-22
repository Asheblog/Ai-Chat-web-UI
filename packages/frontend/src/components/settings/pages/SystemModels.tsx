"use client"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Edit, Plus, Save, Trash2, X } from "lucide-react"
import { useSettingsStore } from "@/store/settings-store"
import { useToast } from "@/components/ui/use-toast"
import type { ModelConfig } from "@/types"

export function SystemModelsPage(){
  const { systemSettings, fetchSystemSettings, createSystemModel, updateSystemModel, deleteSystemModel, isLoading } = useSettingsStore()
  const { toast } = useToast()
  const [isCreateOpen, setCreateOpen] = useState(false)
  const [editingModel, setEditingModel] = useState<ModelConfig|null>(null)
  const [formData, setFormData] = useState({name:'', apiUrl:'', apiKey:'', supportsImages:false})

  useEffect(()=>{ fetchSystemSettings() },[fetchSystemSettings])

  const resetForm=()=> setFormData({name:'', apiUrl:'', apiKey:'', supportsImages:false})

  const handleCreate = async()=>{
    if(!formData.name || !formData.apiUrl || !formData.apiKey){ toast({title:'请填写完整信息'}); return }
    await createSystemModel(formData.name, formData.apiUrl, formData.apiKey, formData.supportsImages)
    setCreateOpen(false); resetForm(); toast({ title: '已创建' })
  }

  const handleUpdate = async()=>{
    if(!editingModel) return
    await updateSystemModel(editingModel.id, {
      name: formData.name,
      apiUrl: formData.apiUrl,
      apiKey: formData.apiKey === '••••••••••••••••' ? undefined : formData.apiKey,
      supportsImages: formData.supportsImages,
    })
    setEditingModel(null); resetForm(); toast({ title: '已更新' })
  }

  const startEdit = (m: ModelConfig)=>{
    setEditingModel(m)
    setFormData({ name: m.name, apiUrl: m.apiUrl, apiKey: '••••••••••••••••', supportsImages: !!m.supportsImages })
  }

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center justify-between">
        <div className="text-base font-medium">系统模型</div>
        <Dialog open={isCreateOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-2"/>新增</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>添加系统模型</DialogTitle>
              <DialogDescription>配置所有用户可使用的系统模型</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">模型名称</Label>
                <Input id="name" value={formData.name} onChange={e=>setFormData(p=>({...p,name:e.target.value}))}/>
              </div>
              <div>
                <Label htmlFor="apiUrl">API 地址</Label>
                <Input id="apiUrl" value={formData.apiUrl} onChange={e=>setFormData(p=>({...p,apiUrl:e.target.value}))}/>
              </div>
              <div>
                <Label htmlFor="apiKey">API 密钥</Label>
                <Input id="apiKey" type="password" value={formData.apiKey} onChange={e=>setFormData(p=>({...p,apiKey:e.target.value}))}/>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="supportsImages">支持图片输入（Vision）</Label>
                  <p className="text-xs text-muted-foreground">不开启则聊天时无法上传图片给该模型</p>
                </div>
                <Switch id="supportsImages" checked={formData.supportsImages} onCheckedChange={(v)=>setFormData(p=>({...p,supportsImages:!!v}))}/>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={()=>setCreateOpen(false)}>取消</Button>
                <Button onClick={handleCreate} disabled={isLoading}>创建</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <div>
        {!systemSettings?.systemModels || systemSettings.systemModels.length===0 ? (
          <div className="text-center py-8 text-muted-foreground">暂无系统模型</div>
        ) : (
          <div className="space-y-3">
            {systemSettings.systemModels.map(model => (
              <div key={model.id} className="flex items-center justify-between p-4 border rounded-lg">
                {editingModel?.id === model.id ? (
                  <div className="flex-1 space-y-3">
                    <Input value={formData.name} onChange={e=>setFormData(p=>({...p,name:e.target.value}))} placeholder="模型名称" />
                    <Input value={formData.apiUrl} onChange={e=>setFormData(p=>({...p,apiUrl:e.target.value}))} placeholder="API 地址" />
                    <Input type="password" value={formData.apiKey} onChange={e=>setFormData(p=>({...p,apiKey:e.target.value}))} placeholder="API 密钥" />
                    <div className="flex items-center justify-between">
                      <div>支持图片输入（Vision）</div>
                      <Switch checked={formData.supportsImages} onCheckedChange={(v)=>setFormData(p=>({...p,supportsImages:!!v}))}/>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleUpdate} disabled={isLoading}><Save className="h-4 w-4 mr-2"/>保存</Button>
                      <Button size="sm" variant="outline" onClick={()=>{setEditingModel(null);resetForm()}}><X className="h-4 w-4 mr-2"/>取消</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex-1">
                      <div className="font-medium">{model.name}</div>
                      <div className="text-sm text-muted-foreground">{model.apiUrl}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="icon" variant="outline" onClick={()=>startEdit(model)}><Edit className="h-4 w-4"/></Button>
                      <Button size="icon" variant="outline" onClick={()=>deleteSystemModel(model.id)} className="text-destructive hover:text-destructive"><Trash2 className="h-4 w-4"/></Button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
