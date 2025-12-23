"use client"
import { Link2, Edit, Trash2 } from 'lucide-react'
import { deriveChannelName } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardTitle, CardDescription } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useSystemConnections, SPECIAL_PROVIDER_DEEPSEEK, SPECIAL_VENDOR_DEEPSEEK } from '@/components/settings/system-connections/use-system-connections'
import { CONNECTION_CAP_KEYS, CONNECTION_CAP_LABELS } from '@/components/settings/system-connections/constants'

export function SystemConnectionsPage() {
  const {
    connections,
    loading,
    error,
    form,
    setForm,
    capabilities,
    editing,
    refresh,
    startEdit,
    cancelEdit,
    submitConnection,
    verifyConnection,
    removeConnection,
    toggleCapability,
    verifyDialogOpen,
    setVerifyDialogOpen,
    verifyResult,
  } = useSystemConnections()

  const handleProviderChange = (value: string) => {
    setForm((prev) => {
      const isGoogle = value === 'google_genai'
      const isDeepseek = value === SPECIAL_PROVIDER_DEEPSEEK
      const next = {
        ...prev,
        provider: value,
        authType: isGoogle || isDeepseek ? 'bearer' : prev.authType,
      }
      if (isDeepseek && (!prev.baseUrl || prev.provider !== SPECIAL_PROVIDER_DEEPSEEK)) {
        next.baseUrl = 'https://api.deepseek.com/v1'
      }
      return next
    })
  }

  const renderVendorLabel = (vendor?: string | null) => {
    if (vendor === SPECIAL_VENDOR_DEEPSEEK) return 'DeepSeek（交错思考）'
    return null
  }

  const baseUrlPlaceholder = (() => {
    if (form.provider === SPECIAL_PROVIDER_DEEPSEEK) return 'https://api.deepseek.com/v1'
    if (form.provider === 'ollama') return 'http://localhost:11434'
    if (form.provider === 'google_genai') return 'https://generativelanguage.googleapis.com/v1beta'
    return 'https://api.openai.com/v1'
  })()

  return (
    <div className="space-y-6 min-w-0">
      <Dialog open={verifyDialogOpen} onOpenChange={setVerifyDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>模型列表</DialogTitle>
            <DialogDescription>
              {verifyResult?.warning
                ? `验证成功，但拉取模型信息时发生警告：${verifyResult.warning}`
                : `共 ${verifyResult?.models?.length ?? 0} 个模型`}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[60vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[220px]">Model ID</TableHead>
                  <TableHead className="min-w-[160px]">Provider</TableHead>
                  <TableHead className="min-w-[120px]">Channel</TableHead>
                  <TableHead className="min-w-[220px]">Tags</TableHead>
                  <TableHead className="min-w-[260px]">Capabilities</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(verifyResult?.models ?? []).map((m) => {
                  const tags = (m.tags ?? []).map((t) => t?.name).filter(Boolean).join(', ')
                  const caps = m.capabilities
                    ? Object.entries(m.capabilities)
                        .filter(([, v]) => v === true)
                        .map(([k]) => k)
                        .join(', ')
                    : ''
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="font-mono text-xs">{m.id}</TableCell>
                      <TableCell className="text-xs">{m.provider}</TableCell>
                      <TableCell className="text-xs">{m.channelName || '-'}</TableCell>
                      <TableCell className="text-xs">{tags || '-'}</TableCell>
                      <TableCell className="text-xs">{caps || '-'}</TableCell>
                    </TableRow>
                  )
                })}
                {(verifyResult?.models?.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-sm text-muted-foreground">
                      未返回模型列表。若上游不支持 /models，请手动填写 Model IDs 后再验证。
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* 连接表单区块 */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b">
          <Link2 className="w-5 h-5 text-primary" />
          <div>
            <CardTitle className="text-lg">连接配置</CardTitle>
            <CardDescription>配置API端点和认证信息</CardDescription>
          </div>
        </div>

        {error && <div className="text-sm text-destructive px-4 py-3 bg-destructive/10 rounded">{error}</div>}

        <Card className="space-y-3 px-4 py-4 sm:px-5 sm:py-5 transition-all hover:border-primary/30 hover:shadow-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Provider</Label>
              <Select
                value={form.provider}
                onValueChange={handleProviderChange}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="openai_responses">OpenAI（Responses）</SelectItem>
                  <SelectItem value="azure_openai">Azure OpenAI</SelectItem>
                  <SelectItem value="ollama">Ollama</SelectItem>
                  <SelectItem value="google_genai">Google Generative AI</SelectItem>
                  <SelectItem value={SPECIAL_PROVIDER_DEEPSEEK}>DeepSeek（交错思考）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Auth</Label>
              <Select
                value={form.authType}
                onValueChange={(v) => setForm((prev) => ({ ...prev, authType: v }))}
                disabled={form.provider === 'google_genai'}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="bearer">Bearer</SelectItem>
                  <SelectItem value="session">Session</SelectItem>
                  <SelectItem value="system_oauth">System OAuth</SelectItem>
                  <SelectItem value="microsoft_entra_id">Entra ID</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-1 sm:col-span-2">
              <Label>Base URL</Label>
              <Input
                value={form.baseUrl}
                onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
                placeholder={baseUrlPlaceholder}
              />
              {(form.provider === 'openai' || form.provider === 'openai_responses') && (
                <p className="mt-1 text-xs text-muted-foreground">
                  填写完整 Base URL（可包含任意路径/版本号）。示例：OpenAI https://api.openai.com/v1；智谱 BigModel https://open.bigmodel.cn/api/coding/paas/v4
                </p>
              )}
              {form.provider === 'google_genai' && (
                <p className="mt-1 text-xs text-muted-foreground">
                  需要在 Google AI Studio 控制台启用 API 并配置 API Key，默认基地址为
                  https://generativelanguage.googleapis.com/v1beta
                </p>
              )}
              {form.provider === SPECIAL_PROVIDER_DEEPSEEK && (
                <p className="mt-1 text-xs text-muted-foreground">
                  使用 DeepSeek 推理模式时，请将 Base URL 指向官方 OpenAI 兼容接口，例如 https://api.deepseek.com/v1
                </p>
              )}
            </div>
            {form.authType === 'bearer' && (
              <div className="col-span-1 sm:col-span-2">
                <Label>API Key</Label>
                <Input
                  type="password"
                  value={form.apiKey}
                  onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
                  placeholder="sk-..."
                />
              </div>
            )}
            {form.provider === 'azure_openai' && (
              <div>
                <Label>API Version</Label>
                <Input
                  value={form.azureApiVersion}
                  onChange={(e) => setForm((prev) => ({ ...prev, azureApiVersion: e.target.value }))}
                  placeholder="2024-02-15-preview"
                />
              </div>
            )}
            <div>
              <Label>Prefix ID</Label>
              <Input
                value={form.prefixId}
                onChange={(e) => setForm((prev) => ({ ...prev, prefixId: e.target.value }))}
                placeholder="可选：前缀，避免冲突"
              />
            </div>
            <div>
              <Label>Connection Type</Label>
              <Select value={form.connectionType} onValueChange={(v) => setForm((prev) => ({ ...prev, connectionType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="external">external</SelectItem>
                  <SelectItem value="local">local</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-1 sm:col-span-2">
              <Label>Tags（逗号分隔）</Label>
              <Input
                value={form.tags}
                onChange={(e) => setForm((prev) => ({ ...prev, tags: e.target.value }))}
                placeholder="prod,team-a"
              />
            </div>
            <div className="col-span-1 sm:col-span-2">
              <Label>默认能力（影响此连接拉取的所有模型）</Label>
              <div className="flex flex-wrap gap-3 text-sm mt-1">
                {CONNECTION_CAP_KEYS.map((k) => (
                  <div key={k} className="flex items-center gap-2">
                    <Checkbox
                      id={`cap-${k}`}
                      checked={capabilities[k]}
                      onCheckedChange={(checked) => toggleCapability(k, Boolean(checked))}
                    />
                    <Label htmlFor={`cap-${k}`} className="font-normal">{CONNECTION_CAP_LABELS[k]}</Label>
                  </div>
                ))}
              </div>
            </div>
            <div className="col-span-1 sm:col-span-2">
              <Label>Model IDs（逗号分隔，留空自动枚举）</Label>
              <Input
                value={form.modelIds}
                onChange={(e) => setForm((prev) => ({ ...prev, modelIds: e.target.value }))}
                placeholder="gpt-4o, gpt-4o-mini, text-embedding-3-small"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                提示：可添加 Embedding 模型用于 RAG 文档解析，如 text-embedding-3-small、nomic-embed-text 等
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={submitConnection} disabled={loading} className="w-full sm:w-auto">{editing ? '保存' : '新增'}</Button>
            <Button onClick={verifyConnection} variant="outline" disabled={loading} className="w-full sm:w-auto">验证连接</Button>
            {editing && (
              <Button onClick={cancelEdit} variant="ghost" className="w-full sm:w-auto">
                取消编辑
              </Button>
            )}
          </div>
        </Card>
      </div>

      {/* 连接列表区块 */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">已配置的连接</CardTitle>
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>刷新</Button>
        </div>

        <div className="space-y-2">
          {loading && connections.length === 0 && (
            <>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="p-3 border rounded">
                  <div className="h-4 w-52 bg-muted rounded" />
                  <div className="mt-2 h-3 w-64 bg-muted/70 rounded" />
                </div>
              ))}
            </>
          )}

          {!loading && connections.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-6">暂无连接，填写上方表单后新增</div>
          )}

          {connections.map((connection) => {
            const channelLabel = deriveChannelName(connection.provider, connection.baseUrl)
            const vendorLabel = renderVendorLabel(connection.vendor)
            return (
              <Card key={connection.id} className="px-4 py-4 sm:px-5 sm:py-5 transition-all hover:border-primary/30 hover:shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-2">
                    <div className="font-medium text-lg">{channelLabel}</div>
                    <div className="text-sm text-muted-foreground break-all">{connection.baseUrl}</div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="px-2 py-1 rounded bg-muted text-muted-foreground">Provider: {connection.provider}</span>
                      {vendorLabel && (
                        <span className="px-2 py-1 rounded bg-muted text-muted-foreground">
                          Vendor: {vendorLabel}
                        </span>
                      )}
                      <span className="px-2 py-1 rounded bg-muted text-muted-foreground">Auth: {connection.authType}</span>
                      {connection.prefixId && <span className="px-2 py-1 rounded bg-muted text-muted-foreground">Prefix: {connection.prefixId}</span>}
                      <span className="px-2 py-1 rounded bg-muted text-muted-foreground">Type: {connection.connectionType}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => startEdit(connection)}>
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => removeConnection(connection.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}
