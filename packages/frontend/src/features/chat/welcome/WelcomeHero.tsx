interface WelcomeHeroProps {
  quotaExhausted: boolean
  brandText: string
}

export function WelcomeHero({ quotaExhausted, brandText }: WelcomeHeroProps) {
  return (
    <div className="mb-8 flex flex-col items-center gap-2 text-center md:mb-10">
      <h1 className="max-w-full text-display font-semibold tracking-tight text-foreground sm:text-display-lg">
        欢迎使用 <span className="text-primary break-all">{brandText}</span>
      </h1>
      <p className="max-w-md text-base text-muted-foreground">
        智能对话，助力高效工作与学习
      </p>
      {quotaExhausted && (
        <p className="text-sm text-destructive">额度已用尽，请登录或等待次日重置</p>
      )}
    </div>
  )
}
