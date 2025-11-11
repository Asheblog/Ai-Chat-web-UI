import { ReactNode } from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SettingsLayoutClient } from "./_components/settings-layout-client"

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="border-b bg-background px-4 py-3">
        <div className="flex items-center gap-4">
          <Link href="/main">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-lg font-semibold">设置</h1>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 min-h-0">
        <SettingsLayoutClient>
          {children}
        </SettingsLayoutClient>
      </div>
    </div>
  )
}
