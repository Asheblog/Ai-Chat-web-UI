import { notFound } from 'next/navigation'
import { PreviewShell } from './preview-shell'
import { resolvePreviewCase } from './preview-cases'

interface PreviewPageProps {
  searchParams: Promise<{ case?: string }>
}

/**
 * 过程工作区 dev 验收页。生产构建直接 404，避免成为正式路由。
 * 案例由 ?case= 决定：completed | running | failure | approval | trace97 | stress | empty | share | battle。
 *
 * 只把 case id 交给客户端：夹具里带命令函数，函数不能跨 server → client 边界传。
 */
export default async function ProcessWorkspacePreviewPage({ searchParams }: PreviewPageProps) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { case: rawCase } = await searchParams
  return <PreviewShell caseId={resolvePreviewCase(rawCase).id} />
}
