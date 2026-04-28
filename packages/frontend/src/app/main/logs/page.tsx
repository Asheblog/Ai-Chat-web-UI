import { LogViewerPage } from "@/components/settings/pages/LogViewerPage"

export default function LogsRoutePage() {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <LogViewerPage />
      </div>
    </div>
  )
}
