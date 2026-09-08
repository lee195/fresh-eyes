// The page-side entry point, injected on demand under `activeTab`.
//
// Ground rule for everything in this folder: the page must not be able to tell
// we are here. No attributes written, no styles applied to the app's own nodes,
// no globals. A tool that perturbs what it measures is worse than no tool.
import type { ContentRequest, ContentResponse } from '@/shared/messages'
import { errorText } from '@/shared/messages'
import { buildCapture, startSignalCollection } from './capture'
import { clearPins, focusPin, showPins } from './pins'

const VERSION = '0.1.0'

// Injection is idempotent: the background script pings before injecting, but a
// double-inject during development should not double-register the listener.
const MARKER = '__freshEyesAttached'
if (!(globalThis as any)[MARKER]) {
  ;(globalThis as any)[MARKER] = true
  startSignalCollection()
  attach()
}

function attach(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const req = message as ContentRequest
    if (!req || typeof req.type !== 'string') return undefined

    handle(req)
      .then(sendResponse)
      .catch((err) =>
        sendResponse({ type: 'ERROR', message: errorText(err) } satisfies ContentResponse),
      )
    return true
  })
}

async function handle(req: ContentRequest): Promise<ContentResponse> {
  switch (req.type) {
    case 'PING':
      return { type: 'PONG', version: VERSION }

    case 'CAPTURE':
      return { type: 'CAPTURE', capture: buildCapture() }

    case 'SHOW_PINS':
      showPins(req.pins, (anchorId) => {
        chrome.runtime.sendMessage({ type: 'PIN_CLICKED', anchorId }).catch(() => {})
      })
      return { type: 'OK' }

    case 'FOCUS_PIN':
      focusPin(req.anchorId)
      return { type: 'OK' }

    case 'CLEAR_PINS':
      clearPins()
      return { type: 'OK' }
  }
}
