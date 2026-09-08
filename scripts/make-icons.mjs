#!/usr/bin/env node
// Generates the toolbar icons.
//
// Written against zlib rather than pulling in an image library: the artwork is
// two ellipses and a circle, and a build dependency that exists to draw three
// shapes is a dependency that will need upgrading for no reason. Run with
// `npm run icons` when the design changes; the PNGs are committed.
import { deflateSync } from 'node:zlib'
import { writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'

const OUT = fileURLToPath(new URL('../icons', import.meta.url))
const SIZES = [16, 32, 48, 128]

const BG = [59, 91, 219] // matches --accent
const SCLERA = [255, 255, 255]
const IRIS = [26, 28, 33]

/** Supersampled coverage of one shape at one pixel, for cheap anti-aliasing. */
const SAMPLES = 4

function inRoundedSquare(x, y, size) {
  const r = size * 0.22
  const cx = Math.min(Math.max(x, r), size - r)
  const cy = Math.min(Math.max(y, r), size - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

function inEllipse(x, y, cx, cy, rx, ry) {
  return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1
}

function coverage(size, test) {
  return (px, py) => {
    let hits = 0
    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const x = px + (sx + 0.5) / SAMPLES
        const y = py + (sy + 0.5) / SAMPLES
        if (test(x, y, size)) hits++
      }
    }
    return hits / (SAMPLES * SAMPLES)
  }
}

function blend(dst, src, alpha) {
  for (let i = 0; i < 3; i++) dst[i] = Math.round(dst[i] * (1 - alpha) + src[i] * alpha)
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4)

  const bg = coverage(size, inRoundedSquare)
  // An almond eye, wider than tall, with the iris slightly high — a gaze, not a target.
  const sclera = coverage(size, (x, y) =>
    inEllipse(x, y, size / 2, size * 0.5, size * 0.34, size * 0.21),
  )
  const iris = coverage(size, (x, y) =>
    inEllipse(x, y, size / 2, size * 0.5, size * 0.115, size * 0.115),
  )

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const pixel = [0, 0, 0]
      let alpha = 0

      const aBg = bg(px, py)
      if (aBg > 0) {
        blend(pixel, BG, 1)
        alpha = aBg
      }
      const aSclera = sclera(px, py) * aBg
      if (aSclera > 0) blend(pixel, SCLERA, aSclera)
      const aIris = iris(px, py) * aBg
      if (aIris > 0) blend(pixel, IRIS, aIris)

      const o = (py * size + px) * 4
      rgba[o] = pixel[0]
      rgba[o + 1] = pixel[1]
      rgba[o + 2] = pixel[2]
      rgba[o + 3] = Math.round(alpha * 255)
    }
  }
  return rgba
}

// --- minimal PNG encoder -----------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = ~0
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return ~c >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  // 10..12: compression, filter, interlace — all 0

  // Filter byte 0 (none) in front of every scanline. The images are tiny; a
  // smarter filter would save bytes no one is counting.
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

await mkdir(OUT, { recursive: true })
for (const size of SIZES) {
  await writeFile(`${OUT}/icon${size}.png`, encodePng(render(size), size))
  console.log(`icons/icon${size}.png`)
}
