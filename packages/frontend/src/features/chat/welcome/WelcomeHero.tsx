interface WelcomeHeroProps {
  quotaExhausted: boolean
  brandText: string
}

export function WelcomeHero({ quotaExhausted, brandText }: WelcomeHeroProps) {
  const initial = (brandText || 'A').trim().charAt(0).toUpperCase()
  return (
    <div className="mb-7 flex flex-col items-center gap-2.5 text-center">
      <span
        className="mb-1 inline-flex h-[46px] w-[46px] select-none items-center justify-center rounded-[14px] bg-foreground text-[23px] font-bold leading-none text-background"
        aria-hidden="true"
      >
        {initial}
      </span>
      <h1 className="max-w-full text-[30px] font-bold leading-[1.25] tracking-[-0.4px] text-foreground">
        欢迎使用 <span className="break-all">{brandText}</span>
      </h1>
      <p className="max-w-md text-[13px] leading-relaxed text-ink-tertiary">
        多模型自由切换 · 联网搜索 · 深度研究
      </p>
      {quotaExhausted && (
        <p className="text-[12px] text-destructive">额度已用尽，请登录或等待次日重置</p>
      )}
    </div>
  )
}
