/** Visual evidence from a read_url result, never a user attachment. */
export interface ToolImageEvidence {
  kind: 'page' | 'resource'
  images: Array<{ sourceUrl: string; title: string; imageUrl: string; dataUrl: string; alt?: string }>
}

export const supportsToolImages = (provider?: string) =>
  provider?.toLowerCase() === 'openai_responses' || provider?.toLowerCase() === 'anthropic'

export function buildToolImageEvidenceParts(content: string, evidence: ToolImageEvidence) {
  return [
    { type: 'text' as const, text: content },
    ...evidence.images.flatMap(({ sourceUrl, title, imageUrl, dataUrl, alt }) => [
      {
        type: 'text' as const,
        text: [
          evidence.kind === 'page' ? '网页候选图（工具抓取）' : '图片资源（工具读取）',
          title && '标题：' + title,
          '来源 URL：' + sourceUrl,
          '图片地址：' + imageUrl,
          alt && '网页替代文本：' + alt,
        ].filter(Boolean).join('\n'),
      },
      { type: 'image_url' as const, image_url: { url: dataUrl } },
    ]),
  ]
}
