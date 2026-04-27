interface WelcomeHeroProps {
  quotaExhausted: boolean
  brandText: string
}

export function WelcomeHero({ quotaExhausted, brandText }: WelcomeHeroProps) {
  return (
    <div className="mb-6 flex flex-col items-center gap-3 text-center md:mb-8">
      <h1 className="max-w-full text-[32px] font-semibold tracking-tight text-slate-900 sm:text-[38px]">
        欢迎使用 <span className="text-primary break-all">{brandText}</span>
      </h1>
      <p className="text-base text-slate-500">智能对话，助力高效工作与学习</p>
      {quotaExhausted && (
        <p className="text-sm text-destructive">额度已用尽，请登录或等待次日重置</p>
      )}
    </div>
  )
}
