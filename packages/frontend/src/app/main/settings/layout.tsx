import { ReactNode } from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SettingsLayoutClient } from "./_components/settings-layout-client"

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="border-b border-border/70 bg-[hsl(var(--background-alt))/0.86] px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-[hsl(var(--background-alt))/0.72]">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-4">
          <Link href="/main">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full border border-border/70 bg-[hsl(var(--surface))/0.5] hover:bg-[hsl(var(--surface-hover))]"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-lg font-semibold tracking-tight">设置</h1>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-6 min-h-0">
        <SettingsLayoutClient>
          {children}
        </SettingsLayoutClient>
      </div>
    </div>
  )
}
