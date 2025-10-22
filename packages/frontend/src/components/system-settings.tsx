'use client'

import { useState, useEffect } from 'react'
import { Plus, Trash2, Edit, Save, X, Users, Shield, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
// 已移除二级标签，改为分段列表行风格
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
import type { ModelConfig, User as UserType, SystemSettings as SystemSettingsType } from '@/types'
import { useSettingsStore } from '@/store/settings-store'
import { useAuthStore } from '@/store/auth-store'
import { useToast } from '@/components/ui/use-toast'
import { formatDate } from '@/lib/utils'

interface ModelFormData {
  name: string
  apiUrl: string
  apiKey: string
  supportsImages: boolean
}

export function SystemSettings() {
  const [activeTab, setActiveTab] = useState('general')
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [editingModel, setEditingModel] = useState<ModelConfig | null>(null)
  const [formData, setFormData] = useState<ModelFormData>({
    name: '',
    apiUrl: '',
    apiKey: '',
    supportsImages: false,
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
    updateSystemModel,
    deleteSystemModel,
    clearError,
  } = useSettingsStore()

  const { user: currentUser } = useAuthStore()
  const { toast } = useToast()
  // 文字LOGO本地草稿，避免每键保存以及中文输入法被打断
  const [brandTextDraft, setBrandTextDraft] = useState('')
  const [isIMEComposing, setIsIMEComposing] = useState(false)

  // —— 流式/稳定性设置草稿 ——
  const [hbMs, setHbMs] = useState<number>(15000)
  const [idleMs, setIdleMs] = useState<number>(60000)
  const [timeoutMs, setTimeoutMs] = useState<number>(300000)
  const [usageEmit, setUsageEmit] = useState<boolean>(true)
  const [usageProviderOnly, setUsageProviderOnly] = useState<boolean>(false)

  useEffect(() => {
    fetchSystemSettings()
  }, [fetchSystemSettings])

  // 当系统设置变化时，同步草稿
  useEffect(() => {
    if (systemSettings) {
      setBrandTextDraft(systemSettings.brandText || '')
      // 同步流式/稳定性设置
      setHbMs(Number(systemSettings.sseHeartbeatIntervalMs ?? 15000))
      setIdleMs(Number(systemSettings.providerMaxIdleMs ?? 60000))
      setTimeoutMs(Number(systemSettings.providerTimeoutMs ?? 300000))
      setUsageEmit(Boolean(systemSettings.usageEmit ?? true))
      setUsageProviderOnly(Boolean(systemSettings.usageProviderOnly ?? false))
    }
  }, [systemSettings?.brandText])

  // 同步依赖更多字段时也触发
  useEffect(() => {
    if (systemSettings) {
      setHbMs(Number(systemSettings.sseHeartbeatIntervalMs ?? 15000))
      setIdleMs(Number(systemSettings.providerMaxIdleMs ?? 60000))
      setTimeoutMs(Number(systemSettings.providerTimeoutMs ?? 300000))
      setUsageEmit(Boolean(systemSettings.usageEmit ?? true))
      setUsageProviderOnly(Boolean(systemSettings.usageProviderOnly ?? false))
    }
  }, [systemSettings?.sseHeartbeatIntervalMs, systemSettings?.providerMaxIdleMs, systemSettings?.providerTimeoutMs, systemSettings?.usageEmit, systemSettings?.usageProviderOnly])

  const msToSec = (v: number) => `${Math.round(v / 1000)} 秒`
  const within = (v: number, min: number, max: number) => v >= min && v <= max

  const hbRange = { min: 1000, max: 600000 }
  const idleRange = { min: 0, max: 3600000 }
  const toutRange = { min: 10000, max: 3600000 }

  const hbValid = within(hbMs, hbRange.min, hbRange.max)
  const idleValid = within(idleMs, idleRange.min, idleRange.max)
  const toutValid = within(timeoutMs, toutRange.min, toutRange.max)

  const crossWarnings: string[] = []
  if (idleMs > 0 && hbMs > idleMs) {
    crossWarnings.push('心跳间隔大于“上游最大空闲”，心跳可能无法保活连接。')
  }
  if (timeoutMs < Math.max(30000, idleMs)) {
    crossWarnings.push('“总体超时”小于建议值，建议 ≥ max(30s, 上游最大空闲)。')
  }

  const changed = (
    hbMs !== Number(systemSettings?.sseHeartbeatIntervalMs ?? 15000) ||
    idleMs !== Number(systemSettings?.providerMaxIdleMs ?? 60000) ||
    timeoutMs !== Number(systemSettings?.providerTimeoutMs ?? 300000) ||
    usageEmit !== Boolean(systemSettings?.usageEmit ?? true) ||
    usageProviderOnly !== Boolean(systemSettings?.usageProviderOnly ?? false)
  )

  const canSaveStreaming = hbValid && idleValid && toutValid && changed && !isLoading

  const handleSaveStreamingSettings = async () => {
    if (!hbValid || !idleValid || !toutValid) return
    await handleUpdateGeneralSettings({
      sseHeartbeatIntervalMs: hbMs,
      providerMaxIdleMs: idleMs,
      providerTimeoutMs: timeoutMs,
      usageEmit,
      usageProviderOnly,
    })
  }

  const resetForm = () => {
    setFormData({
      name: '',
      apiUrl: '',
      apiKey: '',
      supportsImages: false,
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
      await createSystemModel(formData.name, formData.apiUrl, formData.apiKey, formData.supportsImages)

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
        supportsImages: formData.supportsImages,
      }

      if (formData.apiKey !== '••••••••••••••••') {
        updates.apiKey = formData.apiKey
      }

      await updateSystemModel(editingModel.id, updates)
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
      await deleteSystemModel(modelId)
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

  const handleUpdateGeneralSettings = async (updates: Partial<SystemSettingsType>) => {
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
      supportsImages: !!model.supportsImages,
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
      <div>

        {/* 通用设置 */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>系统配置</CardTitle>
              <CardDescription>
                管理系统的基本设置
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
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

              <div className="grid gap-2">
                <Label htmlFor="brandText">文字LOGO</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="brandText"
                    maxLength={40}
                    placeholder="例如：AIChat 或公司名"
                    value={brandTextDraft}
                    onChange={(e) => setBrandTextDraft(e.target.value)}
                    onCompositionStart={() => setIsIMEComposing(true)}
                    onCompositionEnd={() => setIsIMEComposing(false)}
                    onBlur={() => {
                      if (!isIMEComposing && brandTextDraft !== (systemSettings.brandText || '')) {
                        handleUpdateGeneralSettings({ brandText: brandTextDraft })
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleUpdateGeneralSettings({ brandText: brandTextDraft })}
                    disabled={brandTextDraft === (systemSettings.brandText || '')}
                  >
                    保存
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">显示在左上角（类似 ChatGPT）。最多 40 个字符。输入中文不会被打断。</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>流式与网络稳定性</CardTitle>
              <CardDescription>
                配置 SSE 心跳、上游空闲与超时、usage 推送策略；弱网推荐较短心跳。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* 心跳间隔 */}
              <div className="grid gap-2">
                <Label htmlFor="sseHeartbeat">SSE 心跳间隔（毫秒）</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="sseHeartbeat"
                    type="number"
                    min={hbRange.min}
                    max={hbRange.max}
                    step={500}
                    value={hbMs}
                    onChange={(e) => setHbMs(Number(e.target.value || 0))}
                  />
                  <span className="text-sm text-muted-foreground w-24">≈ {msToSec(hbMs)}</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => setHbMs(15000)}>重置为 15000</Button>
                </div>
                {!hbValid && (
                  <p className="text-xs text-destructive">范围 {hbRange.min}–{hbRange.max}（推荐 10000–20000，弱网倾向 10000–15000）</p>
                )}
                {hbValid && (
                  <p className="text-xs text-muted-foreground">推荐 10–15 秒。过长可能被代理判空闲断开。</p>
                )}
              </div>

              {/* 上游最大空闲 */}
              <div className="grid gap-2">
                <Label htmlFor="providerMaxIdle">上游最大空闲（毫秒）</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="providerMaxIdle"
                    type="number"
                    min={idleRange.min}
                    max={idleRange.max}
                    step={1000}
                    value={idleMs}
                    onChange={(e) => setIdleMs(Number(e.target.value || 0))}
                  />
                  <span className="text-sm text-muted-foreground w-24">≈ {msToSec(idleMs)}</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => setIdleMs(60000)}>重置为 60000</Button>
                </div>
                {!idleValid && (
                  <p className="text-xs text-destructive">范围 {idleRange.min}–{idleRange.max}（建议 ≥ 心跳间隔，弱网可适当放宽）</p>
                )}
                {idleValid && (
                  <p className="text-xs text-muted-foreground">建议 ≥ 心跳间隔，典型值 30–90 秒。</p>
                )}
              </div>

              {/* 上游总体超时 */}
              <div className="grid gap-2">
                <Label htmlFor="providerTimeout">上游总体超时（毫秒）</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="providerTimeout"
                    type="number"
                    min={toutRange.min}
                    max={toutRange.max}
                    step={5000}
                    value={timeoutMs}
                    onChange={(e) => setTimeoutMs(Number(e.target.value || 0))}
                  />
                  <span className="text-sm text-muted-foreground w-24">≈ {msToSec(timeoutMs)}</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => setTimeoutMs(300000)}>重置为 300000</Button>
                </div>
                {!toutValid && (
                  <p className="text-xs text-destructive">范围 {toutRange.min}–{toutRange.max}（建议 ≥ 上游最大空闲；常见 120000–300000）</p>
                )}
                {toutValid && (
                  <p className="text-xs text-muted-foreground">建议 ≥ 上游最大空闲；长回答/弱网建议 180–300 秒。</p>
                )}
              </div>

              {/* usage 开关 */}
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="usageEmit">推送用量（usage）</Label>
                  <p className="text-sm text-muted-foreground">开启后在流式过程中向前端发送 usage 事件；关闭则不发送。</p>
                </div>
                <Switch id="usageEmit" checked={usageEmit} onCheckedChange={(v) => setUsageEmit(!!v)} />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="usageProviderOnly">仅透传厂商 usage</Label>
                  <p className="text-sm text-muted-foreground">开启时仅透传上游 usage；关闭时会在结束前基于生成内容估算 completion/total。</p>
                </div>
                <Switch id="usageProviderOnly" checked={usageProviderOnly} onCheckedChange={(v) => setUsageProviderOnly(!!v)} disabled={!usageEmit} />
              </div>

              {crossWarnings.length > 0 && (
                <div className="text-xs text-amber-600">{crossWarnings.map((w, i) => (<div key={i}>{w}</div>))}</div>
              )}

              <div className="flex justify-end">
                <Button onClick={handleSaveStreamingSettings} disabled={!canSaveStreaming}>
                  保存
                </Button>
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
        </div>

        {/* 系统模型 */}
        <div className="space-y-4">
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
                          <div className="flex items-center justify-between">
                            <div>
                              <Label htmlFor="sysSupportsImagesEdit">支持图片输入（Vision）</Label>
                              <p className="text-xs text-muted-foreground">不开启则聊天时无法上传图片给该模型</p>
                            </div>
                            <Switch id="sysSupportsImagesEdit" checked={formData.supportsImages} onCheckedChange={(v) => setFormData(prev => ({ ...prev, supportsImages: !!v }))} />
                          </div>
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
        </div>

        {/* 用户管理 */}
        <div className="space-y-4">
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
        </div>
      </div>
    </div>
  )
}
