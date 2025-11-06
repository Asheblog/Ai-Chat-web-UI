"use client"

import { useState, useEffect, useMemo } from "react"
import { Check, ChevronDown, Search, Eye, Paperclip, Globe, Palette, Terminal, MessageCircle, Star, ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react"
import { useModelsStore, type ModelItem } from "@/store/models-store"
import { cn, deriveChannelName } from "@/lib/utils"
import { modelKeyFor } from "@/store/model-preference-store"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"

interface ModelSelectorProps {
  selectedModelId: string | null
  onModelChange: (model: ModelItem) => void
  disabled?: boolean
  className?: string
  variant?: "default" | "inline"
}

type CapabilityFilter = "all" | "vision" | "code_interpreter" | "image_generation"

// 本地存储键名
const RECENT_MODELS_KEY = "recent-models"
const FAVORITE_MODELS_KEY = "favorite-models"

// 能力映射
const CAPABILITY_ICONS = {
  vision: { icon: Eye, label: "Vision", title: "图片理解" },
  file_upload: { icon: Paperclip, label: "File", title: "文件上传" },
  web_search: { icon: Globe, label: "Web", title: "联网搜索" },
  image_generation: { icon: Palette, label: "Image", title: "图像生成" },
  code_interpreter: { icon: Terminal, label: "Code", title: "代码执行" },
}

export function ModelSelector({ selectedModelId, onModelChange, disabled, className, variant = "default" }: ModelSelectorProps) {
  const [open, setOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const [capabilityFilter, setCapabilityFilter] = useState<CapabilityFilter>("all")
  const [recentModels, setRecentModels] = useState<string[]>([])
  const [favoriteModels, setFavoriteModels] = useState<string[]>([])
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const { models: allModels, isLoading: loading, fetchAll } = useModelsStore()
  const modelsCount = allModels.length

  // 初始化：获取模型数据和本地存储数据
  useEffect(() => {
    if (modelsCount === 0) {
      fetchAll().catch(() => {})
    }

    // 从 localStorage 加载最近使用和收藏
    try {
      const recent = localStorage.getItem(RECENT_MODELS_KEY)
      const favorites = localStorage.getItem(FAVORITE_MODELS_KEY)
      if (recent) setRecentModels(JSON.parse(recent))
      if (favorites) setFavoriteModels(JSON.parse(favorites))
    } catch (e) {
      console.error("Failed to load model preferences:", e)
    }
  }, [modelsCount, fetchAll])

  const selected = allModels.find((m) => {
    if (!selectedModelId) return false
    if (m.id === selectedModelId) return true
    if (m.rawId && m.rawId === selectedModelId) return true
    return modelKeyFor(m) === selectedModelId
  })

  // 添加到最近使用
  const addToRecent = (modelId: string) => {
    const newRecent = [modelId, ...recentModels.filter(id => id !== modelId)].slice(0, 3)
    setRecentModels(newRecent)
    try {
      localStorage.setItem(RECENT_MODELS_KEY, JSON.stringify(newRecent))
    } catch (e) {
      console.error("Failed to save recent models:", e)
    }
  }

  // 切换收藏
  const toggleFavorite = (modelId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const newFavorites = favoriteModels.includes(modelId)
      ? favoriteModels.filter(id => id !== modelId)
      : [...favoriteModels, modelId]
    setFavoriteModels(newFavorites)
    try {
      localStorage.setItem(FAVORITE_MODELS_KEY, JSON.stringify(newFavorites))
    } catch (e) {
      console.error("Failed to save favorite models:", e)
    }
  }

  // 切换分组折叠
  const toggleGroup = (group: string) => {
    const newCollapsed = new Set(collapsedGroups)
    if (newCollapsed.has(group)) {
      newCollapsed.delete(group)
    } else {
      newCollapsed.add(group)
    }
    setCollapsedGroups(newCollapsed)
  }

  // 全部展开
  const expandAll = () => {
    setCollapsedGroups(new Set())
  }

  // 全部折叠
  const collapseAll = () => {
    const allGroups = Object.keys(groupedModels)
    setCollapsedGroups(new Set(allGroups))
  }

  // 切换全部展开/折叠
  const toggleAllGroups = () => {
    if (collapsedGroups.size === 0) {
      // 当前全部展开，则折叠全部
      collapseAll()
    } else {
      // 当前有折叠，则展开全部
      expandAll()
    }
  }

  // 检查模型是否有指定能力
  const hasCapability = (model: ModelItem, capability: string): boolean => {
    return model.capabilities?.[capability as keyof typeof model.capabilities] === true
  }

  // 智能提取模型分组名称
  const extractModelGroup = (model: ModelItem): string => {
    const name = model.name.toLowerCase()
    const id = model.id.toLowerCase()
    const combined = `${name} ${id}`

    // 常见模型系列匹配规则（按优先级排序）
    const modelPatterns = [
      { pattern: /gpt-?4|gpt-?3\.?5|chatgpt|openai/i, group: "OpenAI" },
      { pattern: /claude|anthropic/i, group: "Anthropic" },
      { pattern: /llama|meta-llama/i, group: "Llama" },
      { pattern: /gemini|google|bard/i, group: "Google" },
      { pattern: /command-?r|cohere/i, group: "Cohere" },
      { pattern: /qwen|tongyi|通义/i, group: "Qwen" },
      { pattern: /deepseek/i, group: "DeepSeek" },
      { pattern: /mistral|mixtral/i, group: "Mistral" },
      { pattern: /yi-|零一万物/i, group: "01.AI" },
      { pattern: /moonshot|kimi|月之暗面/i, group: "Moonshot" },
      { pattern: /baichuan|百川/i, group: "Baichuan" },
      { pattern: /chatglm|智谱/i, group: "GLM" },
      { pattern: /ernie|文心/i, group: "ERNIE" },
      { pattern: /spark|讯飞/i, group: "iFlytek" },
      { pattern: /phi-?[0-9]/i, group: "Microsoft" },
      { pattern: /wizardlm|wizard/i, group: "WizardLM" },
      { pattern: /vicuna/i, group: "Vicuna" },
      { pattern: /falcon/i, group: "Falcon" },
      { pattern: /grok/i, group: "xAI" },
      { pattern: /minimax/i, group: "MiniMax" },
    ]

    // 尝试匹配模型系列
    for (const { pattern, group } of modelPatterns) {
      if (pattern.test(combined)) {
        return group
      }
    }

    // 尝试从斜杠格式提取：组织/模型名
    const slashMatch = model.name.match(/^([^/]+)\//)
    if (slashMatch) {
      const org = slashMatch[1]
      // 过滤掉常见的仓库前缀
      if (!['LLM-Research', 'meta-llama', 'TheBloke', 'NousResearch'].includes(org)) {
        return org
      }
    }

    // 尝试从 ID 提取
    const idSlashMatch = model.id.match(/^([^/]+)\//)
    if (idSlashMatch) {
      return idSlashMatch[1]
    }

    // 降级使用 provider
    if (model.provider && model.provider !== 'openai') {
      return model.provider.charAt(0).toUpperCase() + model.provider.slice(1)
    }

    // 最后降级为"其他"
    return "其他"
  }

  // 过滤和分组模型
  const { groupedModels, recentModelsList } = useMemo(() => {
    // 按搜索词和能力过滤
    let filtered = allModels.filter(model => {
      // 搜索过滤
      if (searchTerm) {
        const term = searchTerm.toLowerCase()
        const matchName = model.name.toLowerCase().includes(term)
        const matchProvider = model.provider.toLowerCase().includes(term)
        const matchChannel = (model.channelName || "").toLowerCase().includes(term)
        if (!matchName && !matchProvider && !matchChannel) return false
      }

      // 能力过滤
      if (capabilityFilter !== "all") {
        if (!hasCapability(model, capabilityFilter)) return false
      }

      return true
    })

    // 按智能识别的分组名称分组
    const groups: Record<string, ModelItem[]> = {}
    filtered.forEach(model => {
      const groupName = extractModelGroup(model)
      if (!groups[groupName]) groups[groupName] = []
      groups[groupName].push(model)
    })

    // 对分组进行排序：常见模型优先
    const sortedGroups: Record<string, ModelItem[]> = {}
    const priorityOrder = [
      "OpenAI", "Anthropic", "Google", "DeepSeek", "Llama",
      "Qwen", "Cohere", "Mistral", "Moonshot", "GLM"
    ]

    // 先添加优先级分组
    priorityOrder.forEach(group => {
      if (groups[group]) {
        sortedGroups[group] = groups[group]
      }
    })

    // 再添加其他分组（按字母顺序）
    Object.keys(groups)
      .filter(group => !priorityOrder.includes(group))
      .sort()
      .forEach(group => {
        sortedGroups[group] = groups[group]
      })

    // 获取最近使用的模型对象
    const recent = recentModels
      .map(id => allModels.find(m => modelKeyFor(m) === id || m.id === id))
      .filter((m): m is ModelItem => m !== undefined)
      .slice(0, 3)

    return { groupedModels: sortedGroups, recentModelsList: recent }
  }, [allModels, searchTerm, capabilityFilter, recentModels])

  // 渲染能力徽章
  const renderCapabilities = (model: ModelItem) => {
    const capabilities = model.capabilities || {}
    const activeCapabilities = Object.entries(CAPABILITY_ICONS).filter(([key]) =>
      capabilities[key as keyof typeof capabilities]
    )

    if (activeCapabilities.length === 0) {
      return (
        <Badge variant="secondary" className="text-xs px-2 py-0 h-5">
          <MessageCircle className="w-3 h-3 mr-1" />
          General
        </Badge>
      )
    }

    return (
      <div className="flex gap-1 flex-wrap">
        {activeCapabilities.map(([key, config]) => {
          const Icon = config.icon
          return (
            <Badge
              key={key}
              variant="secondary"
              className="text-xs px-2 py-0 h-5 hover:bg-primary hover:text-primary-foreground transition-colors"
              title={config.title}
            >
              <Icon className="w-3 h-3 mr-1" />
              {config.label}
            </Badge>
          )
        })}
      </div>
    )
  }

  const trigger = (
    <Button
      type="button"
      variant="outline"
      role="combobox"
      aria-expanded={open}
      aria-label="选择模型"
      disabled={disabled}
      className={cn(
        "border-none shadow-none bg-background/80 hover:bg-accent/80",
        variant === "inline" ? "h-10 w-10 px-0 justify-center" : "min-w-[220px] justify-between",
        className
      )}
    >
      {variant === "inline" ? (
        <ChevronDown className={cn("h-4 w-4 transition-transform", open ? "rotate-180" : "")} />
      ) : (
        <>
          <span className="truncate mr-2">{selected ? selected.name : "选择模型"}</span>
          <ChevronDown
            className={cn(
              "ml-auto h-4 w-4 opacity-70 transition-transform",
              open ? "rotate-180" : ""
            )}
          />
        </>
      )}
    </Button>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="p-0 w-[360px]">
        <Command shouldFilter={false}>
          {/* 搜索和筛选区域 */}
          <div className="border-b px-3 py-3 space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <CommandInput
                  placeholder="搜索模型..."
                  value={searchTerm}
                  onValueChange={setSearchTerm}
                  className="pl-8"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-2"
                onClick={toggleAllGroups}
                title={collapsedGroups.size === 0 ? "折叠全部分组" : "展开全部分组"}
              >
                {collapsedGroups.size === 0 ? (
                  <ChevronsDownUp className="h-4 w-4" />
                ) : (
                  <ChevronsUpDown className="h-4 w-4" />
                )}
              </Button>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              <Button
                variant={capabilityFilter === "all" ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setCapabilityFilter("all")}
              >
                全部
              </Button>
              <Button
                variant={capabilityFilter === "vision" ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setCapabilityFilter("vision")}
              >
                多模态
              </Button>
              <Button
                variant={capabilityFilter === "code_interpreter" ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setCapabilityFilter("code_interpreter")}
              >
                推理
              </Button>
              <Button
                variant={capabilityFilter === "image_generation" ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setCapabilityFilter("image_generation")}
              >
                图像生成
              </Button>
            </div>
          </div>

          {/* 最近使用区域 */}
          {recentModelsList.length > 0 && !searchTerm && capabilityFilter === "all" && (
            <div className="border-b px-3 py-3">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                最近使用
              </div>
              <div className="flex gap-2 overflow-x-auto">
                {recentModelsList.map(model => {
                  const key = modelKeyFor(model)
                  return (
                    <button
                      key={key}
                      onClick={() => {
                        onModelChange(model)
                        addToRecent(key)
                        setOpen(false)
                      }}
                      className="flex-shrink-0 min-w-[100px] bg-muted hover:bg-accent border border-border rounded-md px-3 py-2 transition-all hover:-translate-y-0.5"
                    >
                      <div className="text-xs font-medium truncate">{model.name}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{model.provider}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <CommandList className="max-h-[400px]">
            {loading && (
              <div className="p-2 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2 p-2">
                    <Skeleton className="h-4 w-4 rounded" />
                    <div className="flex-1">
                      <Skeleton className="h-3 w-40" />
                      <Skeleton className="mt-1 h-3 w-24" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!loading && Object.keys(groupedModels).length === 0 && (
              <CommandEmpty>
                {searchTerm || capabilityFilter !== "all"
                  ? "未找到匹配的模型"
                  : "暂无可用模型"}
              </CommandEmpty>
            )}

            {!loading && Object.entries(groupedModels).map(([provider, models]) => {
              const isCollapsed = collapsedGroups.has(provider)

              return (
                <div key={provider}>
                  {/* 分组标题 */}
                  <div
                    className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:bg-accent/80 flex items-center gap-1.5 sticky top-0 bg-background z-20 border-b border-border/50 shadow-sm"
                    onClick={() => toggleGroup(provider)}
                  >
                    <ChevronRight className={cn(
                      "h-3 w-3 transition-transform",
                      !isCollapsed && "rotate-90"
                    )} />
                    {provider}
                  </div>

                  {/* 模型列表 */}
                  {!isCollapsed && (
                    <CommandGroup>
                      {models.map((model) => {
                        const key = modelKeyFor(model)
                        const isActive = Boolean(
                          selectedModelId && (
                            selectedModelId === model.id ||
                            selectedModelId === key ||
                            (!!model.rawId && selectedModelId === model.rawId)
                          )
                        )
                        const isFavorite = favoriteModels.includes(key) || favoriteModels.includes(model.id)
                        const channel = model.channelName || deriveChannelName(model.provider, model.connectionBaseUrl)

                        return (
                          <CommandItem
                            key={`${model.connectionId}:${model.id}`}
                            value={`${model.name} ${model.id} ${model.provider} ${channel}`}
                            onSelect={() => {
                              onModelChange(model)
                              addToRecent(key)
                              setOpen(false)
                            }}
                            className={cn(
                              "px-4 py-3 cursor-pointer border-l-4 border-transparent",
                              isActive && "bg-primary/10 border-l-primary"
                            )}
                          >
                            <div className="flex items-start gap-3 flex-1 min-w-0">
                              <div className="flex-1 min-w-0 space-y-1.5">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium truncate">
                                    {model.name}
                                  </span>
                                  {isActive && <Check className="h-4 w-4 flex-shrink-0 text-primary" />}
                                </div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {model.provider} | {channel}
                                </div>
                                {renderCapabilities(model)}
                              </div>

                              <button
                                onClick={(e) => toggleFavorite(key, e)}
                                className={cn(
                                  "flex-shrink-0 p-1 rounded hover:bg-accent transition-colors",
                                  isFavorite ? "text-yellow-500" : "text-muted-foreground"
                                )}
                                aria-label={isFavorite ? "取消收藏" : "收藏"}
                              >
                                <Star className={cn("h-4 w-4", isFavorite && "fill-current")} />
                              </button>
                            </div>
                          </CommandItem>
                        )
                      })}
                    </CommandGroup>
                  )}
                </div>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
