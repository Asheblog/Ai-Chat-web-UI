"use client"

import { Boxes, Cpu, Shield } from "lucide-react"
import { CardDescription, CardTitle } from "@/components/ui/card"
import { SystemModelsPage } from "@/features/settings/pages/system-models"
import { SystemModelAccessPage } from "../SystemModelAccess"

/**
 * 模型管理页：页壳 + 双分区组合（薄）。
 * 上分区「模型目录与能力」原样内嵌 SystemModelsPage，下分区「访问控制」原样内嵌
 * SystemModelAccessPage；两组件共用 useSystemModels hook（store 数据单一来源，
 * UI 局部状态独立，与注册表叠挂行为一致）。页壳仅做组合，不接管加载/错误层。
 */
export function ModelsPage() {
  return (
    <div className="space-y-6 min-w-0">
      {/* 页头 */}
      <div className="flex items-center gap-3 pb-3 border-b border-border/60">
        <Boxes className="w-5 h-5 text-primary flex-shrink-0" />
        <div className="space-y-1">
          <CardTitle className="text-lg font-semibold tracking-tight leading-tight">模型管理</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            管理模型目录、能力开关与访问控制
          </CardDescription>
        </div>
      </div>

      {/* 分区一：模型目录与能力 */}
      <section aria-label="模型目录与能力">
        <div className="mb-4 flex items-start gap-3 border-b border-border/70 pb-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
            <Cpu className="h-5 w-5" />
          </span>
          <div>
            <h2 className="v2-section-title">模型目录与能力</h2>
            <p className="v2-muted-line mt-1">
              管理模型目录，开关图片理解/图像生成等能力，调整上下文窗口与温度参数。
            </p>
          </div>
        </div>
        <SystemModelsPage />
      </section>

      {/* 分隔 */}
      <div className="border-t border-border/60" />

      {/* 分区二：访问控制 */}
      <section aria-label="访问控制">
        <div className="mb-4 flex items-start gap-3 border-b border-border/70 pb-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
            <Shield className="h-5 w-5" />
          </span>
          <div>
            <h2 className="v2-section-title">访问控制</h2>
            <p className="v2-muted-line mt-1">
              配置模型默认访问策略，并为特定模型设置匿名/注册用户的访问控制。
            </p>
          </div>
        </div>
        <SystemModelAccessPage />
      </section>
    </div>
  )
}
