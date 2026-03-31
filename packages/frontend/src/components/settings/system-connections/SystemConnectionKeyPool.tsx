"use client"

import { AnimatePresence, motion } from "framer-motion"
import { KeyRound, Trash2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { ConnectionKeyFormState } from "./use-system-connections"

type SystemConnectionKeyPoolProps = {
  keys: ConnectionKeyFormState[]
  reducedMotion: boolean
  onAddKey: () => void
  onRemoveKey: (clientId: string) => void
  onUpdateKey: (
    clientId: string,
    updater: (current: ConnectionKeyFormState) => ConnectionKeyFormState,
  ) => void
}

export function SystemConnectionKeyPool({
  keys,
  reducedMotion,
  onAddKey,
  onRemoveKey,
  onUpdateKey,
}: SystemConnectionKeyPoolProps) {
  return (
    <Card className="border-border/70 bg-background/55 shadow-none">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <CardTitle className="text-lg">Key 池</CardTitle>
          <CardDescription>
            同端点下的每个 Key 都可以保留自己绑定的模型范围，适合 NewAPI 一类按 Key 分组的网关。
          </CardDescription>
        </div>
        <Button type="button" variant="outline" onClick={onAddKey} className="min-h-11">
          <Plus className="mr-2 h-4 w-4" />
          添加 Key
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <AnimatePresence initial={false}>
          {keys.map((key, index) => (
            <motion.div
              key={key.clientId}
              layout={!reducedMotion}
              initial={reducedMotion ? false : { opacity: 0, y: 10 }}
              animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
              exit={reducedMotion ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="rounded-3xl border border-border/70 bg-[hsl(var(--background))/0.72] p-4"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <div className="inline-flex items-center gap-2">
                    <div className="rounded-full border border-primary/20 bg-primary/10 p-2 text-primary">
                      <KeyRound className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-sm font-medium">{key.apiKeyLabel || `Key ${index + 1}`}</div>
                      <div className="text-xs text-muted-foreground">
                        {key.hasStoredApiKey
                          ? `已保存 ${key.apiKeyMasked || "密钥摘要"}，留空表示继续沿用`
                          : "新条目需要填写真实 API Key"}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="inline-flex items-center gap-2 rounded-full border border-border/70 px-3 py-1.5 text-sm">
                    <Checkbox
                      checked={key.enable}
                      onCheckedChange={(checked) =>
                        onUpdateKey(key.clientId, (current) => ({
                          ...current,
                          enable: Boolean(checked),
                        }))
                      }
                    />
                    <span>启用</span>
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-11 px-3 text-destructive hover:text-destructive"
                    onClick={() => onRemoveKey(key.clientId)}
                    aria-label={`删除 ${key.apiKeyLabel || `Key ${index + 1}`}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor={`key-label-${key.clientId}`}>Key 标签</Label>
                    <Input
                      id={`key-label-${key.clientId}`}
                      value={key.apiKeyLabel}
                      onChange={(event) =>
                        onUpdateKey(key.clientId, (current) => ({
                          ...current,
                          apiKeyLabel: event.target.value,
                        }))
                      }
                      placeholder={`Key ${index + 1}`}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`key-secret-${key.clientId}`}>API Key</Label>
                    <Input
                      id={`key-secret-${key.clientId}`}
                      type="password"
                      value={key.apiKey}
                      onChange={(event) =>
                        onUpdateKey(key.clientId, (current) => ({
                          ...current,
                          apiKey: event.target.value,
                        }))
                      }
                      placeholder={key.hasStoredApiKey ? "留空则继续使用已保存的 Key" : "sk-..."}
                    />
                    <p className="text-xs leading-5 text-muted-foreground">
                      {key.hasStoredApiKey
                        ? `当前已保存摘要：${key.apiKeyMasked || "已保存"}`
                        : "新建时建议立即写明用途，例如 team-a、group-1、images。"}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`key-models-${key.clientId}`}>Model IDs</Label>
                  <Textarea
                    id={`key-models-${key.clientId}`}
                    value={key.modelIds}
                    onChange={(event) =>
                      onUpdateKey(key.clientId, (current) => ({
                        ...current,
                        modelIds: event.target.value,
                      }))
                    }
                    placeholder={"gpt-4o-mini\ngpt-4.1-mini\ntext-embedding-3-small"}
                    className="min-h-[116px]"
                  />
                  <p className="text-xs leading-5 text-muted-foreground">
                    支持逗号或换行分隔。留空时会尝试从这个 Key 对应的上游接口自动枚举模型。
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </CardContent>
    </Card>
  )
}
