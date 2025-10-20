'use client'

import { useState, useEffect } from 'react'
import { Plus, Trash2, Edit, Save, X, Users, Shield, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Switch } from '@/components/ui/switch'
import { ModelConfig, User as UserType, SystemSettings } from '@/types'
import { useSettingsStore } from '@/store/settings-store'
import { useAuthStore } from '@/store/auth-store'
import { useToast } from '@/components/ui/use-toast'
import { formatDate } from '@/lib/utils'

interface ModelFormData {
  name: string
  apiUrl: string
  apiKey: string
}

export function SystemSettings() {
  const [activeTab, setActiveTab] = useState('general')
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [editingModel, setEditingModel] = useState<ModelConfig | null>(null)
  const [formData, setFormData] = useState<ModelFormData>({
    name: '',
    apiUrl: '',
    apiKey: '',
  })

  const {
    systemSettings,
    personalModels,
    isLoading,
    error,
    fetchSystemSettings,
    fetchPersonalModels,
    updateSystemSettings,
    createSystemModel,
    updatePersonalModel,
    deletePersonalModel,
    clearError,
  } = useSettingsStore()

  const { user: currentUser } = useAuthStore()
  const { toast } = useToast()

  useEffect(() => {
    fetchSystemSettings()
  }, [fetchSystemSettings])

  const resetForm = () => {
    setFormData({
      name: '',
      apiUrl: '',
      apiKey: '',
    })
    setEditingModel(null)
  }

  const handleCreateSystemModel = async () => {
    if (!formData.name || !formData.apiUrl || !formData.apiKey) {
      toast({
        title: "验证失败",
        description: "请填写完整的模型信息",
        variant: "destructive",
      })
      return
    }

    try {
      // 使用系统模型创建接口（管理员）
      await createSystemModel(formData.name, formData.apiUrl, formData.apiKey)

      // 更新系统设置以包含新模型
      if (systemSettings) {
        const updatedModels = [...(systemSettings.systemModels || [])]
        // 这里假设新创建的模型会被添加到系统模型列表中
        await updateSystemSettings({
          ...systemSettings,
          systemModels: updatedModels,
        })
      }

      setIsCreateDialogOpen(false)
      resetForm()
      toast({
        title: "创建成功",
        description: "系统模型已创建",
      })
    } catch (error) {
      toast({
        title: "创建失败",
        description: error instanceof Error ? error.message : "未知错误",
        variant: "destructive",
      })
    }
  }

  const handleUpdateSystemModel = async () => {
    if (!editingModel || !formData.name || !formData.apiUrl) {
      toast({
        title: "验证失败",
        description: "请填写完整的模型信息",
        variant: "destructive",
      })
      return
    }

    try {
      const updates: Partial<ModelFormData> = {
        name: formData.name,
        apiUrl: formData.apiUrl,
      }

      if (formData.apiKey !== '••••••••••••••••') {
        updates.apiKey = formData.apiKey
      }

      await updatePersonalModel(editingModel.id, updates)
      setEditingModel(null)
      resetForm()
      toast({
        title: "更新成功",
        description: "系统模型已更新",
      })
    } catch (error) {
      toast({
        title: "更新失败",
        description: error instanceof Error ? error.message : "未知错误",
        variant: "destructive",
      })
    }
  }

  const handleDeleteSystemModel = async (modelId: number) => {
    try {
      await deletePersonalModel(modelId)
      toast({
        title: "删除成功",
        description: "系统模型已删除",
      })
    } catch (error) {
      toast({
        title: "删除失败",
        description: error instanceof Error ? error.message : "未知错误",
        variant: "destructive",
      })
    }
  }

  const handleUpdateGeneralSettings = async (updates: Partial<SystemSettings>) => {
    try {
      await updateSystemSettings(updates)
      toast({
        title: "更新成功",
        description: "系统设置已更新",
      })
    } catch (error) {
      toast({
        title: "更新失败",
        description: error instanceof Error ? error.message : "未知错误",
        variant: "destructive",
      })
    }
  }

  const startEditModel = (model: ModelConfig) => {
    setEditingModel(model)
    setFormData({
      name: model.name,
      apiUrl: model.apiUrl,
      apiKey: '••••••••••••••••',
    })
  }

  const cancelEdit = () => {
    setEditingModel(null)
    resetForm()
  }

  if (!systemSettings) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">加载系统设置中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="general">通用设置</TabsTrigger>
          <TabsTrigger value="models">系统模型</TabsTrigger>
          <TabsTrigger value="users">用户管理</TabsTrigger>
        </TabsList>

        {/* 通用设置 */}
        <TabsContent value="general" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>系统配置</CardTitle>
              <CardDescription>
                管理系统的基本设置
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="allowRegistration">允许用户注册</Label>
                  <p className="text-sm text-muted-foreground">
                    关闭后将禁止新用户注册，仅管理员可创建用户
                  </p>
                </div>
                <Switch
                  id="allowRegistration"
                  checked={systemSettings.allowRegistration}
                  onCheckedChange={(checked) =>
                    handleUpdateGeneralSettings({ allowRegistration: checked })
                  }
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>系统信息</CardTitle>
              <CardDescription>
                查看系统运行状态
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-4 border rounded-lg">
                  <div className="text-2xl font-bold text-primary">
                    {/* 这里应该显示实际的统计数字 */}
                    {systemSettings.systemModels?.length || 0}
                  </div>
                  <div className="text-sm text-muted-foreground">系统模型</div>
                </div>
                <div className="text-center p-4 border rounded-lg">
                  <div className="text-2xl font-bold text-primary">
                    {/* 这里应该显示实际的统计数字 */}
                    0
                  </div>
                  <div className="text-sm text-muted-foreground">注册用户</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 系统模型 */}
        <TabsContent value="models" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>系统模型</CardTitle>
                  <CardDescription>
                    管理所有用户可用的系统级AI模型
                  </CardDescription>
                </div>
                <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="h-4 w-4 mr-2" />
                      添加系统模型
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>添加系统模型</DialogTitle>
                      <DialogDescription>
                        配置所有用户都可使用的系统AI模型
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="name">模型名称</Label>
                        <Input
                          id="name"
                          placeholder="例如: GPT-4"
                          value={formData.name}
                          onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                        />
                      </div>
                      <div>
                        <Label htmlFor="apiUrl">API 地址</Label>
                        <Input
                          id="apiUrl"
                          placeholder="https://api.openai.com/v1/chat/completions"
                          value={formData.apiUrl}
                          onChange={(e) => setFormData(prev => ({ ...prev, apiUrl: e.target.value }))}
                        />
                      </div>
                      <div>
                        <Label htmlFor="apiKey">API 密钥</Label>
                        <Input
                          id="apiKey"
                          type="password"
                          placeholder="sk-..."
                          value={formData.apiKey}
                          onChange={(e) => setFormData(prev => ({ ...prev, apiKey: e.target.value }))}
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                          取消
                        </Button>
                        <Button onClick={handleCreateSystemModel} disabled={isLoading}>
                          创建
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {!systemSettings.systemModels || systemSettings.systemModels.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>暂无系统模型配置</p>
                  <p className="text-sm">点击上方按钮添加第一个系统模型</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {systemSettings.systemModels.map((model) => (
                    <div key={model.id} className="flex items-center justify-between p-4 border rounded-lg">
                      {editingModel?.id === model.id ? (
                        // 编辑模式
                        <div className="flex-1 space-y-3">
                          <Input
                            placeholder="模型名称"
                            value={formData.name}
                            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                          />
                          <Input
                            placeholder="API 地址"
                            value={formData.apiUrl}
                            onChange={(e) => setFormData(prev => ({ ...prev, apiUrl: e.target.value }))}
                          />
                          <Input
                            type="password"
                            placeholder="API 密钥"
                            value={formData.apiKey}
                            onChange={(e) => setFormData(prev => ({ ...prev, apiKey: e.target.value }))}
                          />
                          <div className="flex gap-2">
                            <Button size="sm" onClick={handleUpdateSystemModel} disabled={isLoading}>
                              <Save className="h-4 w-4 mr-2" />
                              保存
                            </Button>
                            <Button size="sm" variant="outline" onClick={cancelEdit}>
                              <X className="h-4 w-4 mr-2" />
                              取消
                            </Button>
                          </div>
                        </div>
                      ) : (
                        // 显示模式
                        <>
                          <div className="flex-1">
                            <h3 className="font-medium">{model.name}</h3>
                            <p className="text-sm text-muted-foreground">{model.apiUrl}</p>
                            <p className="text-xs text-muted-foreground">
                              创建于 {formatDate(model.createdAt)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="icon"
                              variant="outline"
                              onClick={() => startEditModel(model)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="outline"
                              onClick={() => handleDeleteSystemModel(model.id)}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 用户管理 */}
        <TabsContent value="users" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>用户管理</CardTitle>
              <CardDescription>
                管理系统中的所有用户（功能开发中）
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>用户管理功能正在开发中</p>
                <p className="text-sm">即将支持用户列表、角色管理等功能</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
