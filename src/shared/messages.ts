// The message protocol.
//
// Three contexts talk to each other: the side panel (Vue), the background
// service worker (orchestration and all network calls), and the content script
// injected into the page under inspection. Every message is a member of one of
// the unions below, so adding a case without handling it is a type error.
import type { Capture, Session } from './types'
import { api } from './browser'

// ---------------------------------------------------------------------------
// Panel → background
// ---------------------------------------------------------------------------

export type PanelRequest =
  /** Which tab are we looking at, is its origin allowed, is a backend configured. */
  | { type: 'GET_CONTEXT' }
  | { type: 'RUN'; personaId: string; goal: string }
  | { type: 'CANCEL' }
  /** Panel row hovered/selected — tell the content script to emphasise its pin. */
  | { type: 'FOCUS_ANCHOR'; anchorId: string | null }
  | { type: 'CLEAR_PINS' }
  /** Grant the model endpoint's origin, or the page origin, on demand. */
  | { type: 'REQUEST_HOST_PERMISSION'; origin: string }

export interface PanelContext {
  tabId: number | null
  url: string | null
  origin: string | null
  /** False when the origin is outside the allowlist and needs confirmation. */
  originAllowed: boolean
  /** Null when no backend has been configured yet. */
  backend: { id: string; label: string; model: string; endpointHost: string } | null
  viewport: { w: number; h: number } | null
}

export type PanelResponse =
  | { type: 'CONTEXT'; context: PanelContext }
  | { type: 'CAPTURE'; capture: Capture }
  | { type: 'SESSION'; session: Session }
  | { type: 'PERMISSION'; granted: boolean }
  | { type: 'OK' }
  | { type: 'ERROR'; message: string }

// ---------------------------------------------------------------------------
// Background → content script
// ---------------------------------------------------------------------------

export type ContentRequest =
  /** Build the perceivable page model. Never includes typed input values. */
  | { type: 'CAPTURE' }
  /** Draw markers for these anchors. */
  | { type: 'SHOW_PINS'; pins: { anchorId: string; seq: number; severity: number }[] }
  | { type: 'FOCUS_PIN'; anchorId: string | null }
  | { type: 'CLEAR_PINS' }
  | { type: 'PING' }

export type ContentResponse =
  | { type: 'CAPTURE'; capture: Omit<Capture, 'screenshot'> }
  | { type: 'PONG'; version: string }
  | { type: 'OK' }
  | { type: 'ERROR'; message: string }

// ---------------------------------------------------------------------------
// Background → panel (unsolicited progress)
// ---------------------------------------------------------------------------

export type BackgroundEvent =
  | { type: 'SESSION_UPDATE'; session: Session }
  | { type: 'PROGRESS'; stage: 'capturing' | 'analyzing' | 'grounding'; detail?: string }
  /** The dev clicked a pin in the page; select that row in the panel. */
  | { type: 'PIN_CLICKED'; anchorId: string }

// ---------------------------------------------------------------------------
// Typed senders
// ---------------------------------------------------------------------------

export async function sendToBackground(req: PanelRequest): Promise<PanelResponse> {
  try {
    return (await api.runtime.sendMessage(req)) as PanelResponse
  } catch (err) {
    return { type: 'ERROR', message: errorText(err) }
  }
}

export async function sendToTab(tabId: number, req: ContentRequest): Promise<ContentResponse> {
  try {
    return (await api.tabs.sendMessage(tabId, req)) as ContentResponse
  } catch (err) {
    // Almost always "no receiving end": the content script is not injected yet.
    return { type: 'ERROR', message: errorText(err) }
  }
}

export function emit(event: BackgroundEvent): void {
  // No listener is a normal state — the panel may simply be closed.
  api.runtime.sendMessage(event).catch(() => {})
}

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return String(err)
}
