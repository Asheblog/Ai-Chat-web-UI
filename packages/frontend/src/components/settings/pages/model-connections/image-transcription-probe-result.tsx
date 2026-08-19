import { Badge } from "@/components/ui/badge"
import type { ImageTranscriptionProbeResult } from "@/features/settings/api"

const STEP_LABELS: Record<string, string> = {
  transcribe: "转写",
  relevance: "相关性",
}

export function probeFailureMessage(err: unknown): string {
  const maybe = err as {
    code?: string
    response?: { status?: number; data?: { error?: string } }
    message?: string
  }
  if (
    maybe?.code === "ECONNABORTED" ||
    maybe?.response?.status === 504 ||
    /timeout/i.test(maybe?.message ?? "")
  ) {
    return "转写模型请求超时"
  }
  return maybe?.response?.data?.error || maybe?.message || "测试转写代理失败"
}

export function ProbeResultPanel({ result }: { result: ImageTranscriptionProbeResult }) {
  return (
    <div className="space-y-2 rounded-lg border border-border/70 bg-card/50 p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">探针结果</span>
        <Badge variant={result.ok ? "default" : "destructive"}>
          {result.ok ? "成功" : "失败"}
        </Badge>
      </div>
      <ul className="space-y-2">
        {result.steps.map((step) => (
          <li
            key={step.name}
            className="rounded-md border border-border/60 px-3 py-2 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">
                {STEP_LABELS[step.name] ?? step.name}
              </span>
              <span className="text-xs text-muted-foreground">{step.name}</span>
              <Badge variant={step.ok ? "outline" : "destructive"}>
                {step.ok ? "通过" : "未通过"}
              </Badge>
              <span className="text-xs text-muted-foreground">{step.durationMs} ms</span>
            </div>
            {step.detail ? (
              <p className="mt-1 break-words text-muted-foreground">{step.detail}</p>
            ) : null}
            {step.error ? (
              <p className="mt-1 break-words text-destructive">{step.error}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
