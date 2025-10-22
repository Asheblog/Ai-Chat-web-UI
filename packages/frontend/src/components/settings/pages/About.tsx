"use client"

export function AboutPage(){
  return (
    <section className="rounded-xl border overflow-hidden">
      <div className="px-4 py-3 font-medium border-b">关于</div>
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between"><span>版本</span><span className="text-muted-foreground">1.0.0</span></div>
        <div className="flex items-center justify-between"><span>技术栈</span><span className="text-muted-foreground">Next.js + Hono + SQLite</span></div>
      </div>
    </section>
  )
}

