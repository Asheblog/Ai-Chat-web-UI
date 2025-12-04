interface WelcomeHeroProps {
  quotaExhausted: boolean
}

export function WelcomeHero({ quotaExhausted }: WelcomeHeroProps) {
  return (
    <div className="text-center flex flex-col items-center gap-3 mb-8">
      <h1 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight">
        有什么可以帮忙的?
      </h1>
      {quotaExhausted && (
        <p className="text-sm text-destructive">额度已用尽，请登录或等待次日重置</p>
      )}
    </div>
  )
}
