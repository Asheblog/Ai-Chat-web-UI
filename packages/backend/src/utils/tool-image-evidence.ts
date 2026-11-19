/** Visual evidence from a read_url result, never a user attachment. */
export interface ToolImageEvidence {
  kind: 'page' | 'resource'
  sourceUrl: string
  title: string
  images: Array<{ imageUrl: string; dataUrl: string; alt?: string }>
}

export function buildToolImageEvidenceParts(content: string, evidence: ToolImageEvidence) {
  return [
    { type: 'text' as const, text: content },
    ...evidence.images.flatMap(({ imageUrl, dataUrl, alt }) => [
      {
        type: 'text' as const,
        text: [
          evidence.kind === 'page' ? '网页候选图（工具抓取）' : '图片资源（工具读取）',
          evidence.title && '标题：' + evidence.title,
          '网页来源：' + evidence.sourceUrl,
          '图片地址：' + imageUrl,
          alt && '网页替代文本：' + alt,
        ].filter(Boolean).join('\n'),
      },
      { type: 'image_url' as const, image_url: { url: dataUrl } },
    ]),
  ]
}
