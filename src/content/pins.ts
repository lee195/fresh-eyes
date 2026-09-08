// Numbered markers over the elements that caused each reaction.
//
// This code runs inside an app the developer is actively working on, so the
// constraint that shapes it is: leave no trace. Everything lives in a closed
// shadow root on one fixed host element. The app cannot style it, cannot query
// into it, and no element of the app is ever given an attribute or a class.
import { resolveById } from './capture'

const HOST_ID = 'fresh-eyes-overlay'

/** Marker diameter, and therefore how far outside the element it is parked. */
const PIN_SIZE = 22

const SEVERITY_COLORS = ['', '#7a8194', '#4c8bd8', '#d99b28', '#dd6b20', '#d0342c'] as const

function clampSeverity(severity: number): 1 | 2 | 3 | 4 | 5 {
  return Math.min(5, Math.max(1, Math.round(severity))) as 1 | 2 | 3 | 4 | 5
}

interface Pin {
  anchorId: string
  seq: number
  severity: number
}

interface Marker extends Pin {
  el: HTMLElement
  target: Element | null
}

let root: ShadowRoot | null = null
let layer: HTMLElement | null = null
let markers: Marker[] = []
let frame = 0
let focused: string | null = null

function ensureLayer(): HTMLElement {
  if (layer) return layer

  const host = document.createElement('div')
  host.id = HOST_ID
  // Fixed and non-interactive so it can never intercept a click meant for the
  // app, and never contributes to the app's scroll height.
  host.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:2147483646;border:0;margin:0;padding:0;'

  // Closed: the page cannot reach in through `shadowRoot`, so nothing here can
  // be read or restyled by the app under inspection.
  root = host.attachShadow({ mode: 'closed' })
  root.appendChild(styles())

  layer = document.createElement('div')
  root.appendChild(layer)
  document.documentElement.appendChild(host)

  addEventListener('scroll', schedule, { passive: true, capture: true })
  addEventListener('resize', schedule, { passive: true })

  return layer
}

function styles(): HTMLStyleElement {
  const style = document.createElement('style')
  style.textContent = `
    :host, * { box-sizing: border-box; }
    .pin {
      position: absolute;
      pointer-events: auto;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      margin: -11px 0 0 -11px;
      border-radius: 50%;
      border: 2px solid #fff;
      box-shadow: 0 1px 4px rgba(0,0,0,.4);
      font: 600 11px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      color: #fff;
      cursor: pointer;
      transition: transform .12s ease;
    }
    .pin:hover, .pin.focused { transform: scale(1.35); }
    /* Outline only — the halo marks an element the developer is trying to
       look at, so it must never cover it. */
    .halo {
      position: absolute;
      border-radius: 4px;
      border: 2px solid;
      background: none;
      opacity: 0;
      transition: opacity .12s ease;
      pointer-events: none;
    }
    .halo.focused { opacity: .9; }
    .sev-1 { background: #7a8194; }
    .sev-2 { background: #4c8bd8; }
    .sev-3 { background: #d99b28; }
    .sev-4 { background: #dd6b20; }
    .sev-5 { background: #d0342c; }
  `
  return style
}

export function showPins(pins: Pin[], onPinClick: (anchorId: string) => void): void {
  clearPins()
  const container = ensureLayer()

  markers = pins.map((pin) => {
    const el = document.createElement('div')
    el.className = `pin sev-${Math.min(5, Math.max(1, pin.severity))}`
    el.textContent = String(pin.seq)
    el.title = `Reaction ${pin.seq}`
    el.addEventListener('click', (event) => {
      event.stopPropagation()
      onPinClick(pin.anchorId)
    })
    container.appendChild(el)

    const halo = document.createElement('div')
    halo.className = 'halo'
    halo.style.borderColor = SEVERITY_COLORS[clampSeverity(pin.severity)]
    container.appendChild(halo)
    ;(el as HTMLElement & { halo?: HTMLElement }).halo = halo

    return { ...pin, el, target: resolveById(pin.anchorId) }
  })

  position()
}

export function focusPin(anchorId: string | null): void {
  focused = anchorId
  for (const marker of markers) {
    const isFocused = marker.anchorId === anchorId
    marker.el.classList.toggle('focused', isFocused)
    halo(marker)?.classList.toggle('focused', isFocused)
  }
  if (anchorId) {
    const marker = markers.find((m) => m.anchorId === anchorId)
    marker?.target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

export function clearPins(): void {
  for (const marker of markers) {
    halo(marker)?.remove()
    marker.el.remove()
  }
  markers = []
  focused = null
}

function halo(marker: Marker): HTMLElement | undefined {
  return (marker.el as HTMLElement & { halo?: HTMLElement }).halo
}

function schedule(): void {
  if (frame || markers.length === 0) return
  frame = requestAnimationFrame(() => {
    frame = 0
    position()
  })
}

function position(): void {
  for (const marker of markers) {
    // Single-page apps replace nodes constantly. Re-resolving through the
    // stored path means a pin survives a re-render of the same view instead of
    // silently drifting to the wrong place.
    if (!marker.target?.isConnected) marker.target = resolveById(marker.anchorId)

    const rect = marker.target?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) {
      marker.el.style.display = 'none'
      const h = halo(marker)
      if (h) h.style.display = 'none'
      continue
    }

    marker.el.style.display = ''
    // Parked just outside the element's left edge rather than on top of it: the
    // whole point is to draw attention to that text, and a disc sitting over
    // the first character hides the word being complained about. Clamped so a
    // full-bleed element does not push its pin off screen.
    marker.el.style.left = `${Math.max(PIN_SIZE / 2, rect.left - PIN_SIZE / 2)}px`
    marker.el.style.top = `${rect.top + Math.min(rect.height / 2, PIN_SIZE)}px`

    const h = halo(marker)
    if (h) {
      h.style.display = ''
      h.style.left = `${rect.left - 3}px`
      h.style.top = `${rect.top - 3}px`
      h.style.width = `${rect.width + 6}px`
      h.style.height = `${rect.height + 6}px`
      h.classList.toggle('focused', marker.anchorId === focused)
    }
  }
}
