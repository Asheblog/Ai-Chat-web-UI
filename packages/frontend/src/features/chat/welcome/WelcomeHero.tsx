interface WelcomeHeroProps {
  brandText: string
  quotaExhausted: boolean
  quotaLabel: string | number
}

export function WelcomeHero({ brandText, quotaExhausted, quotaLabel }: WelcomeHeroProps) {
  return (
    <div className="text-center flex flex-col items-center gap-3 mb-8">
      <div className="text-sm uppercase tracking-[0.3em] text-muted-foreground">{brandText}</div>
      <h1 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight">
        有什么可以帮忙的?
      </h1>
      {quotaExhausted ? (
        <p className="text-sm text-destructive">额度已用尽，请登录或等待次日重置</p>
      ) : (
        <p className="text-sm text-muted-foreground">今日剩余 {quotaLabel} 条消息额度</p>
      )}
    </div>
  )
}
