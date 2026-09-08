// Builds the perceivable page model.
//
// Raw HTML is the wrong thing to send a model: it is enormous, and most of it
// is plumbing no human perceives. What a person reacts to is a much smaller
// set — visible, named, positioned things, plus a handful of felt qualities
// (waiting, jitter, breakage) that no single element states.
//
// Nothing here writes to the DOM. Element identity lives in a WeakMap, so the
// app under inspection cannot see that it was measured.
import type { Capture, CapturedNode, CaptureSignals, Fold } from '@/shared/types'
import { redactSensitive } from '@/shared/redact'

/** Above this, the page model stops being cheap to send. Chosen for ~6k tokens. */
export const NODE_BUDGET = 400
const MAX_TEXT_CHARS = 300

const idByElement = new WeakMap<Element, string>()
const elementById = new Map<string, WeakRef<Element>>()
const pathById = new Map<string, string>()
let idCounter = 0

// ---------------------------------------------------------------------------
// Felt signals — collected from attach time, read at capture time
// ---------------------------------------------------------------------------

const signalState = {
  cls: 0,
  pageErrors: 0,
}

/**
 * Starts watching for the things a user feels rather than sees.
 *
 * Page errors come from `error`/`unhandledrejection` events rather than by
 * wrapping `console.error`: patching a global the app owns would be visible to
 * it, and uncaught errors are the ones a user actually experiences as breakage.
 */
export function startSignalCollection(): void {
  // Paint timings are read at capture time instead, from the buffer directly —
  // see readPaintTimings. Only layout shift needs an observer, because it
  // accumulates over the life of the page rather than sitting in the buffer.
  observe('layout-shift', (entries) => {
    for (const e of entries as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
      if (!e.hadRecentInput) signalState.cls += e.value
    }
  })

  addEventListener('error', () => void signalState.pageErrors++, true)
  addEventListener('unhandledrejection', () => void signalState.pageErrors++)
}

/**
 * Reads paint timings out of the performance buffer at capture time.
 *
 * A `buffered: true` observer looks like it would do this, but its callback
 * only fires on a later task. We are injected on demand and asked to capture
 * almost immediately after, so that callback loses the race and every run
 * reports no timing at all — which is precisely the run where "how long did
 * they wait" matters. The buffer itself is there to be read synchronously.
 */
function readPaintTimings(): { fcpMs?: number; lcpMs?: number } {
  const out: { fcpMs?: number; lcpMs?: number } = {}
  try {
    for (const entry of performance.getEntriesByType('paint')) {
      if (entry.name === 'first-contentful-paint') out.fcpMs = Math.round(entry.startTime)
    }
    const lcp = performance.getEntriesByType('largest-contentful-paint').at(-1)
    if (lcp) out.lcpMs = Math.round(lcp.startTime)
  } catch {
    // Not every browser keeps every entry type. A missing signal is fine.
  }
  return out
}

function observe(type: string, cb: (entries: PerformanceEntry[]) => void): void {
  try {
    // `buffered` matters: we are injected long after load, so without it every
    // timing signal would be empty on the run that matters most.
    new PerformanceObserver((list) => cb(list.getEntries())).observe({ type, buffered: true })
  } catch {
    // Not every browser exposes every entry type. A missing signal is fine.
  }
}

// ---------------------------------------------------------------------------
// Element identity
// ---------------------------------------------------------------------------

function idFor(el: Element): string {
  let id = idByElement.get(el)
  if (!id) {
    id = `fe-${++idCounter}`
    idByElement.set(el, id)
  }
  elementById.set(id, new WeakRef(el))
  return id
}

/** Resolves a capture id back to a live element, falling back to its path. */
export function resolveById(id: string): Element | null {
  const live = elementById.get(id)?.deref()
  if (live?.isConnected) return live

  // The app re-rendered and replaced the node. The nth-child path finds
  // whatever now occupies the same structural position, which for a re-render
  // of the same view is the same thing.
  const path = pathById.get(id)
  if (!path) return null
  try {
    return document.querySelector(path)
  } catch {
    return null
  }
}

/** An nth-child path, stable enough to survive a re-render of the same view. */
export function pathOf(el: Element): string {
  const parts: string[] = []
  let node: Element | null = el
  while (node && node !== document.documentElement) {
    const parent: Element | null = node.parentElement
    if (!parent) break
    const index = Array.prototype.indexOf.call(parent.children, node) + 1
    parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`)
    node = parent
  }
  return parts.length ? `html > ${parts.join(' > ')}` : 'html'
}

// ---------------------------------------------------------------------------
// Perception filters
// ---------------------------------------------------------------------------

const SKIP_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'meta',
  'link',
  'title',
  'head',
  'svg',
  'path',
  'br',
])

const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary'])
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'tab',
  'menuitem',
  'switch',
  'combobox',
  'textbox',
  'slider',
  'option',
])

export function isInteractive(el: Element, role: string): boolean {
  const tag = el.tagName.toLowerCase()
  if (INTERACTIVE_TAGS.has(tag)) return !(tag === 'a' && !el.hasAttribute('href'))
  if (INTERACTIVE_ROLES.has(role)) return true
  const tabindex = el.getAttribute('tabindex')
  return tabindex !== null && Number(tabindex) >= 0
}

/** Rendered and non-transparent, i.e. something a person could actually see. */
export function isVisible(el: Element, cs: CSSStyleDeclaration, rect: DOMRect): boolean {
  if (cs.display === 'none' || cs.visibility === 'hidden') return false
  if (Number(cs.opacity) === 0) return false
  if (el.getAttribute('aria-hidden') === 'true') return false
  if (rect.width === 0 || rect.height === 0) return false
  return true
}

export function inferRole(el: Element): string {
  const explicit = el.getAttribute('role')
  if (explicit) return explicit.split(/\s+/)[0]!

  const tag = el.tagName.toLowerCase()
  if (/^h[1-6]$/.test(tag)) return 'heading'
  switch (tag) {
    case 'a':
      return el.hasAttribute('href') ? 'link' : 'text'
    case 'button':
      return 'button'
    case 'img':
      return 'image'
    case 'input': {
      const t = (el as HTMLInputElement).type
      if (t === 'checkbox' || t === 'radio' || t === 'submit' || t === 'button') return t
      return 'input'
    }
    case 'select':
      return 'select'
    case 'textarea':
      return 'input'
    case 'label':
      return 'label'
    case 'form':
      return 'form'
    case 'nav':
      return 'navigation'
    case 'ul':
    case 'ol':
      return 'list'
    case 'table':
      return 'table'
    default:
      return 'text'
  }
}

/**
 * An approximation of the accessible name.
 *
 * The full accname algorithm is large and mostly matters for edge cases; this
 * covers the sources that decide what a screen reader — or a person skimming —
 * would call the thing.
 */
export function accessibleName(el: Element): string {
  const aria = el.getAttribute('aria-label')
  if (aria?.trim()) return clean(aria)

  const labelledBy = el.getAttribute('aria-labelledby')
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
    if (text.trim()) return clean(text)
  }

  const tag = el.tagName.toLowerCase()
  if (tag === 'img') return clean(el.getAttribute('alt') ?? '')

  if (tag === 'input' || tag === 'select' || tag === 'textarea') {
    // `.labels` is the platform's own answer to "what is this field called",
    // covering both `for=` and wrapping labels without any selector escaping.
    for (const label of labelsOf(el)) {
      if (label.textContent?.trim()) return clean(label.textContent)
    }
    // Deliberately no placeholder fallback: a placeholder disappears the moment
    // you type, which is exactly when someone unsure of themselves needs it.
    return ''
  }

  if (INTERACTIVE_TAGS.has(tag) || INTERACTIVE_ROLES.has(el.getAttribute('role') ?? '')) {
    const text = el.textContent ?? ''
    if (text.trim()) return clean(text)
  }

  return clean(el.getAttribute('title') ?? '')
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS)
}

/**
 * Text belonging to this element itself, not to its descendants.
 *
 * Returned at full length. Truncation happens where the node is built, so that
 * "how long is the longest wall of text" measures the wall the reader actually
 * faces rather than our own display limit.
 */
export function ownText(el: Element): string {
  let out = ''
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) out += child.nodeValue ?? ''
  }
  return out.replace(/\s+/g, ' ').trim()
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

function parseColor(value: string): [number, number, number, number] | null {
  const m = value.match(/rgba?\(([^)]+)\)/)
  if (!m) return null
  const parts = m[1]!.split(',').map((p) => Number.parseFloat(p.trim()))
  const [r, g, b] = parts
  if (r === undefined || g === undefined || b === undefined) return null
  return [r, g, b, parts[3] ?? 1]
}

function relativeLuminance([r, g, b]: [number, number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** Walks up for the first opaque background — what the text is really sitting on. */
function effectiveBackground(el: Element): [number, number, number, number] {
  let node: Element | null = el
  while (node) {
    const color = parseColor(getComputedStyle(node).backgroundColor)
    if (color && color[3] > 0.5) return color
    node = node.parentElement
  }
  return [255, 255, 255, 1]
}

function contrastRatio(el: Element, cs: CSSStyleDeclaration): number | undefined {
  const fg = parseColor(cs.color)
  if (!fg) return undefined
  const bg = effectiveBackground(el)
  const l1 = relativeLuminance(fg)
  const l2 = relativeLuminance(bg)
  const [light, dark] = l1 > l2 ? [l1, l2] : [l2, l1]
  return Math.round(((light + 0.05) / (dark + 0.05)) * 10) / 10
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

interface Candidate {
  node: CapturedNode
  /** Higher survives the node budget. */
  priority: number
  order: number
}

export function buildCapture(): Omit<Capture, 'screenshot'> {
  elementById.clear()
  pathById.clear()

  // A tab that is not rendering — minimised, collapsed, hidden — reports every
  // element as zero-sized, so the visibility filter discards the entire page.
  // Returning that as an empty page model would be worse than useless: the
  // analysis would confidently describe a blank screen. Fail where the cause is
  // still legible instead.
  if (window.innerWidth === 0 || window.innerHeight === 0) {
    throw new Error(
      'This tab is not being rendered, so nothing has a size or position. Bring the window to the front and try again.',
    )
  }

  const viewportH = window.innerHeight
  const scrollY = window.scrollY
  const candidates: Candidate[] = []
  let order = 0
  let fakeClickables = 0
  let smallestFontPx = Number.POSITIVE_INFINITY
  let worstContrastRatio: number | undefined
  let longestTextBlockChars = 0

  const walk = (el: Element, parentId: string | null, consumed: boolean): void => {
    const tag = el.tagName.toLowerCase()
    if (SKIP_TAGS.has(tag)) return

    const cs = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    if (!isVisible(el, cs, rect)) return // an invisible subtree is invisible entirely

    const role = inferRole(el)
    const interactive = isInteractive(el, role)
    const name = accessibleName(el)
    const text = consumed ? '' : redactSensitive(ownText(el))

    // Keyboard-unreachable but styled as clickable. Even if a mouse click
    // works, this is the shape of the "why is nothing happening" trap.
    const looksClickable =
      cs.cursor === 'pointer' && !interactive && !el.hasAttribute('href') && !el.closest('a,button')
    if (looksClickable) fakeClickables++

    const worthCapturing = interactive || role === 'heading' || role === 'image' || text.length > 0

    let myId = parentId
    if (worthCapturing) {
      const id = idFor(el)
      const path = pathOf(el)
      pathById.set(id, path)
      myId = id

      const fontSizePx = Math.round(Number.parseFloat(cs.fontSize) || 0)
      const ratio = text.length > 0 ? contrastRatio(el, cs) : undefined

      if (text.length > 0 && fontSizePx > 0) smallestFontPx = Math.min(smallestFontPx, fontSizePx)
      if (ratio !== undefined && (worstContrastRatio === undefined || ratio < worstContrastRatio)) {
        worstContrastRatio = ratio
      }
      longestTextBlockChars = Math.max(longestTextBlockChars, text.length)

      const docY = rect.top + scrollY
      const fold: Fold = docY < viewportH ? 'above' : 'below'

      candidates.push({
        node: {
          id,
          role,
          name,
              // The ellipsis matters: without it a paragraph cut mid-word reads as
          // a sentence the page genuinely left unfinished, and the analysis
          // reports our truncation as the site's own bug.
          text:
            text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS).trimEnd()}…` : text,
          tag,
          box: {
            x: Math.round(rect.left + window.scrollX),
            y: Math.round(docY),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
          },
          fold,
          interactive,
          state: formState(el),
          style: { fontSizePx, contrastRatio: ratio, looksClickable },
          path,
          parentId,
        },
        priority: priorityOf(role, interactive, fold),
        order: order++,
      })
    }

    // A button whose label sits in a nested span should be one node, not three.
    const shortLabelled = interactive && (el.textContent?.length ?? 0) < 100
    for (const child of el.children) walk(child, myId, consumed || shortLabelled)
  }

  if (document.body) walk(document.body, null, false)

  const truncated = candidates.length > NODE_BUDGET
  const kept = truncated ? applyBudget(candidates) : candidates

  const signals: CaptureSignals = {
    ...readPaintTimings(),
    cls: Math.round(signalState.cls * 1000) / 1000,
    pageErrors: signalState.pageErrors,
    fakeClickables,
    longestTextBlockChars,
    smallestFontPx: Number.isFinite(smallestFontPx) ? smallestFontPx : 0,
    worstContrastRatio,
    truncated,
  }

  return {
    id: `cap-${Date.now().toString(36)}`,
    url: location.href,
    origin: location.origin,
    title: document.title,
    capturedAt: Date.now(),
    viewport: {
      w: window.innerWidth,
      h: viewportH,
      dpr: window.devicePixelRatio,
      scrollY,
      pageHeight: document.documentElement.scrollHeight,
    },
    nodes: kept.map((c) => c.node),
    signals,
  }
}

/**
 * Never captures a form control's value.
 *
 * The dev may well have typed a real email or a real card number into their own
 * staging form. Labels, types and validation state are what the analysis needs;
 * the value adds nothing and is the one field that could hurt someone.
 */
export function formState(el: Element): CapturedNode['state'] | undefined {
  const tag = el.tagName.toLowerCase()
  if (tag !== 'input' && tag !== 'select' && tag !== 'textarea') return undefined

  const control = el as HTMLInputElement
  if (control.type === 'password') {
    return { inputType: 'password', required: control.required, hasLabel: hasLabel(control) }
  }

  return {
    inputType: control.type || tag,
    disabled: control.disabled || undefined,
    required: control.required || undefined,
    invalid: control.validity && !control.validity.valid ? true : undefined,
    validationMessage: clean(control.validationMessage ?? '') || undefined,
    placeholder: clean(control.placeholder ?? '') || undefined,
    checked: control.type === 'checkbox' || control.type === 'radio' ? control.checked : undefined,
    hasLabel: hasLabel(control),
  }
}

function hasLabel(el: HTMLInputElement): boolean {
  if (el.getAttribute('aria-label')?.trim()) return true
  if (el.getAttribute('aria-labelledby')) return true
  return labelsOf(el).length > 0
}

/** The labels the platform associates with a control, `for=` or wrapping. */
function labelsOf(el: Element): HTMLLabelElement[] {
  const native = (el as HTMLInputElement).labels
  if (native) return Array.from(native)
  const wrapping = el.closest('label')
  return wrapping ? [wrapping] : []
}

/** What survives when the page is bigger than the budget. */
export function priorityOf(role: string, interactive: boolean, fold: Fold): number {
  let p = 0
  if (interactive) p += 4
  if (role === 'heading') p += 3
  if (role === 'image') p += 1
  if (fold === 'above') p += 2 // they may never scroll at all
  return p
}

export function applyBudget(candidates: Candidate[]): Candidate[] {
  return [...candidates]
    .sort((a, b) => b.priority - a.priority || a.order - b.order)
    .slice(0, NODE_BUDGET)
    .sort((a, b) => a.order - b.order) // reading order is the narrative
}
