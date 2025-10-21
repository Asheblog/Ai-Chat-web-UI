'use client'

import { useState, useEffect } from 'react'
import { Plus, Trash2, Edit, Save, X, ExternalLink } from 'lucide-react'
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
import { ModelConfig } from '@/types'
import { Switch } from '@/components/ui/switch'
import { useSettingsStore } from '@/store/settings-store'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'

interface ModelFormData {
  name: string
  apiUrl: string
  apiKey: string
  supportsImages: boolean
}

export function PersonalSettings() {
  const [activeTab, setActiveTab] = useState('models')
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [editingModel, setEditingModel] = useState<ModelConfig | null>(null)
  const [formData, setFormData] = useState<ModelFormData>({
    name: '',
    apiUrl: '',
    apiKey: '',
    supportsImages: false,
  })

  const {
    theme,
    maxTokens,
    personalModels,
    isLoading,
    error,
    fetchPersonalModels,
    createPersonalModel,
    updatePersonalModel,
    deletePersonalModel,
    setTheme,
    setMaxTokens,
    clearError,
  } = useSettingsStore()

  const { toast } = useToast()

  useEffect(() => {
    fetchPersonalModels()
  }, [fetchPersonalModels])

  const resetForm = () => {
    setFormData({
      name: '',
      apiUrl: '',
      apiKey: '',
      supportsImages: false,
    })
    setEditingModel(null)
  }

  const handleCreateModel = async () => {
    if (!formData.name || !formData.apiUrl || !formData.apiKey) {
      toast({
        title: "验证失败",
        description: "请填写完整的模型信息",
        variant: "destructive",
      })
      return
    }

    try {
      await createPersonalModel(formData.name, formData.apiUrl, formData.apiKey, formData.supportsImages)
      setIsCreateDialogOpen(false)
      resetForm()
      toast({
        title: "创建成功",
        description: "模型配置已创建",
      })
    } catch (error) {
      toast({
        title: "创建失败",
        description: error instanceof Error ? error.message : "未知错误",
        variant: "destructive",
      })
    }
  }

  const handleUpdateModel = async () => {
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
        supportsImages: formData.supportsImages,
      }

      // 只有当API密钥被修改时才包含它
      if (formData.apiKey !== '••••••••••••••••') {
        updates.apiKey = formData.apiKey
      }

      await updatePersonalModel(editingModel.id, updates)
      setEditingModel(null)
      resetForm()
      toast({
        title: "更新成功",
        description: "模型配置已更新",
      })
    } catch (error) {
      toast({
        title: "更新失败",
        description: error instanceof Error ? error.message : "未知错误",
        variant: "destructive",
      })
    }
  }

  const handleDeleteModel = async (modelId: number) => {
    try {
      await deletePersonalModel(modelId)
      toast({
        title: "删除成功",
        description: "模型配置已删除",
      })
    } catch (error) {
      toast({
        title: "删除失败",
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
      apiKey: '••••••••••••••••', // 隐藏真实API密钥
      supportsImages: !!model.supportsImages,
    })
  }

  const cancelEdit = () => {
    setEditingModel(null)
    resetForm()
  }

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="models">模型配置</TabsTrigger>
          <TabsTrigger value="preferences">偏好设置</TabsTrigger>
        </TabsList>

        {/* 模型配置 */}
        <TabsContent value="models" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>个人模型</CardTitle>
                  <CardDescription>
                    配置您自己的AI模型API密钥
                  </CardDescription>
                </div>
                <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="h-4 w-4 mr-2" />
                      添加模型
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>添加新模型</DialogTitle>
                      <DialogDescription>
                        配置您的自定义AI模型API
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
                      <div className="flex items-center justify-between">
                        <div>
                          <Label htmlFor="supportsImages">支持图片输入（Vision）</Label>
                          <p className="text-xs text-muted-foreground">开启后，聊天框可上传图片传给该模型</p>
                        </div>
                        <Switch id="supportsImages" checked={formData.supportsImages} onCheckedChange={(v) => setFormData(prev => ({ ...prev, supportsImages: !!v }))} />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                          取消
                        </Button>
                        <Button onClick={handleCreateModel} disabled={isLoading}>
                          创建
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {personalModels.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>暂无个人模型配置</p>
                  <p className="text-sm">点击上方按钮添加您的第一个模型</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {personalModels.map((model) => (
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
                          <div className="flex items-center justify-between">
                            <div>
                              <Label htmlFor="supportsImagesEdit">支持图片输入（Vision）</Label>
                              <p className="text-xs text-muted-foreground">不支持图片的模型将禁用图片上传</p>
                            </div>
                            <Switch id="supportsImagesEdit" checked={formData.supportsImages} onCheckedChange={(v) => setFormData(prev => ({ ...prev, supportsImages: !!v }))} />
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" onClick={handleUpdateModel} disabled={isLoading}>
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
                              创建于 {new Date(model.createdAt).toLocaleDateString()}
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
                              onClick={() => handleDeleteModel(model.id)}
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

        {/* 偏好设置 */}
        <TabsContent value="preferences" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>界面设置</CardTitle>
              <CardDescription>
                自定义应用的外观和行为
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="theme">主题</Label>
                <Select value={theme} onValueChange={(value: 'light' | 'dark' | 'system') => setTheme(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">浅色模式</SelectItem>
                    <SelectItem value="dark">深色模式</SelectItem>
                    <SelectItem value="system">跟随系统</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="maxTokens">上下文限制 (Tokens)</Label>
                <Input
                  id="maxTokens"
                  type="number"
                  min="1000"
                  max="32000"
                  step="1000"
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(parseInt(e.target.value) || 4000)}
                />
                <p className="text-sm text-muted-foreground mt-1">
                  控制AI对话历史记录的最大token数量，较大的值可以提供更多上下文但会消耗更多资源
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>关于</CardTitle>
              <CardDescription>
                应用信息和帮助
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span>版本</span>
                <span className="text-muted-foreground">1.0.0</span>
              </div>
              <div className="flex items-center justify-between">
                <span>技术栈</span>
                <span className="text-muted-foreground">Next.js + Hono + SQLite</span>
              </div>
              <div className="pt-4">
                <Button variant="outline" asChild>
                  <a
                    href="https://github.com/your-repo/aichat"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center"
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    查看源码
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
