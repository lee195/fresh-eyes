// Grabbing and shrinking the visible viewport.
//
// Runs in the service worker, which has no `document` — so `OffscreenCanvas`
// and `createImageBitmap` do the resizing rather than an `<img>` and a canvas.
import { api } from '@/shared/browser'

/** Wide enough for a vision model to read UI text, small enough to send. */
const MAX_WIDTH = 1024
const JPEG_QUALITY = 0.7

/**
 * Captures the visible part of a tab, downscaled.
 *
 * Returns null rather than throwing when the grab is not permitted: `activeTab`
 * is granted by the developer invoking the extension, and it lapses when they
 * switch tabs. A run without a screenshot is still a useful run — the page
 * model carries the structure — so a missing image degrades the analysis
 * instead of failing it.
 */
export async function captureViewport(windowId: number): Promise<string | null> {
  let raw: string
  try {
    raw = await api.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 80 })
  } catch {
    return null
  }
  if (!raw) return null

  try {
    return await downscale(raw)
  } catch {
    // Better a full-size screenshot than none, if only the resize failed.
    return raw
  }
}

async function downscale(dataUrl: string): Promise<string> {
  const source = await createImageBitmap(await (await fetch(dataUrl)).blob())

  if (source.width <= MAX_WIDTH) {
    source.close()
    return dataUrl
  }

  const scale = MAX_WIDTH / source.width
  const canvas = new OffscreenCanvas(MAX_WIDTH, Math.round(source.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    source.close()
    return dataUrl
  }

  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  source.close()

  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY })
  return `data:image/jpeg;base64,${toBase64(await blob.arrayBuffer())}`
}

/** `FileReader` is not dependable in a service worker, so encode by hand. */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  // Chunked to stay well under the argument limit on large screenshots.
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
