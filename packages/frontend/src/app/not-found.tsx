'use client'
export const dynamic = 'force-dynamic'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-2">页面不存在</h1>
        <p className="text-muted-foreground">请检查链接是否正确。</p>
      </div>
    </div>
  )
}

