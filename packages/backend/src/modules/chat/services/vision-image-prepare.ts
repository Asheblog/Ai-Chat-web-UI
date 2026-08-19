import sharp from 'sharp'

/** Empirically verified against OpenCode Go / Xiaomi MiMo: 1x1 PNG → HTTP 400; 32x32 PNG succeeds. */
export const MIN_VISION_IMAGE_EDGE_PX = 32

export async function ensureMinVisionImageEdge(
  image: { data: string; mime: string },
  minEdge = MIN_VISION_IMAGE_EDGE_PX,
): Promise<{ data: string; mime: string }> {
  try {
    const buffer = Buffer.from(image.data, 'base64')
    const meta = await sharp(buffer, { failOnError: false }).metadata()
    const width = meta.width ?? 0
    const height = meta.height ?? 0
    if (width <= 0 || height <= 0) return image
    if (width >= minEdge && height >= minEdge) return image
    const out = await sharp(buffer, { failOnError: false })
      .resize(Math.max(width, minEdge), Math.max(height, minEdge), {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png()
      .toBuffer()
    return { data: out.toString('base64'), mime: 'image/png' }
  } catch {
    return image
  }
}

export async function ensureMinVisionImages(
  images: Array<{ data: string; mime: string }>,
  minEdge = MIN_VISION_IMAGE_EDGE_PX,
): Promise<Array<{ data: string; mime: string }>> {
  return Promise.all(images.map((image) => ensureMinVisionImageEdge(image, minEdge)))
}
