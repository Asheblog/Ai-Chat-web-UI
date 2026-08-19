import { deflateSync } from 'node:zlib'

/** Empirically: OpenCode Go / Xiaomi MiMo reject 1x1 PNG with HTTP 400; 32x32 succeeds. Probe uses 64 as a margin. */
export const MIN_VISION_PROBE_EDGE_PX = 64

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c
  }
  return table
})()

const crc32 = (buffer: Buffer): number => {
  let c = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]!) & 0xff]! ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

const pngChunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData), 0)
  return Buffer.concat([length, typeAndData, crc])
}

/**
 * Deterministic split-color PNG (left blue / right rose) large enough for strict vision APIs.
 */
export const createVisionProbePngBase64 = (): string => {
  const size = MIN_VISION_PROBE_EDGE_PX
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const rows: Buffer[] = []
  const mid = Math.floor(size / 2)
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 3)
    for (let x = 0; x < size; x += 1) {
      const offset = 1 + x * 3
      if (x < mid) {
        row[offset] = 37
        row[offset + 1] = 99
        row[offset + 2] = 235
      } else {
        row[offset] = 225
        row[offset + 1] = 29
        row[offset + 2] = 72
      }
    }
    rows.push(row)
  }
  const png = Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
  return png.toString('base64')
}

export const BUILT_IN_PROBE_IMAGE_BASE64 = createVisionProbePngBase64()
export const BUILT_IN_PROBE_IMAGE_MIME = 'image/png'
