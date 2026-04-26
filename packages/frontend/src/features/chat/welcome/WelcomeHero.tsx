import { BarChart3, Code2, FileText } from 'lucide-react'

interface WelcomeHeroProps {
  quotaExhausted: boolean
}

export function WelcomeHero({ quotaExhausted }: WelcomeHeroProps) {
  return (
    <div className="mb-16 flex flex-col items-center gap-5 text-center md:mb-20">
      <h1 className="text-[32px] font-semibold tracking-tight text-slate-900 sm:text-[38px]">
        欢迎使用 <span className="text-primary">AIChat</span>
      </h1>
      <p className="text-base text-slate-500">智能对话，助力高效工作与学习</p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-4">
        <span className="v2-chip min-w-[180px] justify-center">
          <FileText className="h-5 w-5 text-primary" />
          帮我总结长文档
        </span>
        <span className="v2-chip min-w-[180px] justify-center">
          <BarChart3 className="h-5 w-5 text-primary" />
          分析数据趋势
        </span>
        <span className="v2-chip min-w-[220px] justify-center">
          <Code2 className="h-5 w-5 text-primary" />
          解释这段代码的作用
        </span>
      </div>
      {quotaExhausted && (
        <p className="text-sm text-destructive">额度已用尽，请登录或等待次日重置</p>
      )}
    </div>
  )
}
