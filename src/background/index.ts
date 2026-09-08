// The service worker: orchestration, and the only place that touches the network.
//
// Model calls never happen in the content script. The page under inspection
// would be able to observe them, its CSP would apply, and a dev's own app
// should not be able to see the request that is judging it.
import { api, hasSidePanel } from '@/shared/browser'
import type { PanelContext, PanelRequest, PanelResponse } from '@/shared/messages'
import { emit, errorText, sendToTab } from '@/shared/messages'
import { endpointHost, getSettings, isOriginAllowed } from '@/shared/settings'
import { cancelRun, runAnalysis } from './run'
import { getBackend } from '@/shared/backends'

const CONTENT_SCRIPT = 'content.js'

// ---------------------------------------------------------------------------
// Opening the panel
// ---------------------------------------------------------------------------

if (hasSidePanel()) {
  api.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err: unknown) => console.warn('[fresh-eyes] side panel behavior:', errorText(err)))
} else {
  // Firefox: the toolbar button toggles the sidebar.
  api.action?.onClicked.addListener(() => {
    ;(api as any).sidebarAction?.toggle?.()
  })
}

// ---------------------------------------------------------------------------
// Content script injection
// ---------------------------------------------------------------------------

/**
 * Makes sure the content script is live in a tab, injecting it if not.
 *
 * The extension declares no `content_scripts`, so it runs on nothing until the
 * dev asks for a run — at which point `activeTab` covers the injection. That is
 * why installing Fresh Eyes does not ask for access to any site.
 */
async function ensureContentScript(tabId: number): Promise<void> {
  const ping = await sendToTab(tabId, { type: 'PING' })
  if (ping.type === 'PONG') return

  await api.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT] })

  const retry = await sendToTab(tabId, { type: 'PING' })
  if (retry.type !== 'PONG') {
    throw new Error(
      'Could not attach to this tab. Browser-internal pages and the extension gallery are off limits.',
    )
  }
}

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true })
  return tab ?? null
}

function originOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Panel requests
// ---------------------------------------------------------------------------

async function buildContext(): Promise<PanelContext> {
  const tab = await activeTab()
  const settings = await getSettings()
  const origin = originOf(tab?.url)

  const backendId = settings.activeBackendId
  const config = backendId ? settings.backends[backendId] : undefined

  return {
    tabId: tab?.id ?? null,
    url: tab?.url ?? null,
    origin,
    originAllowed: origin ? isOriginAllowed(origin, settings) : false,
    backend:
      backendId && config
        ? {
            id: backendId,
            label: getBackend(backendId)?.label ?? backendId,
            model: config.model,
            endpointHost: endpointHost(config),
          }
        : null,
    viewport: tab?.width && tab?.height ? { w: tab.width, h: tab.height } : null,
  }
}

async function handle(req: PanelRequest): Promise<PanelResponse> {
  switch (req.type) {
    case 'GET_CONTEXT':
      return { type: 'CONTEXT', context: await buildContext() }

    case 'REQUEST_HOST_PERMISSION': {
      const granted = await api.permissions.request({ origins: [`${req.origin}/*`] })
      return { type: 'PERMISSION', granted }
    }

    case 'FOCUS_ANCHOR': {
      const tab = await activeTab()
      if (tab?.id) await sendToTab(tab.id, { type: 'FOCUS_PIN', anchorId: req.anchorId })
      return { type: 'OK' }
    }

    case 'CLEAR_PINS': {
      const tab = await activeTab()
      if (tab?.id) await sendToTab(tab.id, { type: 'CLEAR_PINS' })
      return { type: 'OK' }
    }

    case 'RUN': {
      const tab = await activeTab()
      if (!tab?.id) return { type: 'ERROR', message: 'No active tab.' }
      await ensureContentScript(tab.id)

      const session = await runAnalysis(tab, req.personaId, req.goal)
      emit({ type: 'SESSION_UPDATE', session })

      // Draw the pins straight away, so the page and the panel agree the moment
      // the panel has something to show.
      const pins = (session.analysis?.reactions ?? [])
        .filter((r) => r.anchorId)
        .map((r) => ({ anchorId: r.anchorId!, seq: r.seq, severity: r.severity }))
      if (pins.length) await sendToTab(tab.id, { type: 'SHOW_PINS', pins })

      return { type: 'SESSION', session }
    }

    case 'CANCEL':
      cancelRun()
      return { type: 'OK' }
  }
}

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const req = message as PanelRequest
  if (!req || typeof req.type !== 'string') return undefined

  // Events emitted by this worker come back through the same channel; ignore them.
  if (!isPanelRequest(req)) return undefined

  handle(req)
    .then(sendResponse)
    .catch((err) => sendResponse({ type: 'ERROR', message: errorText(err) } satisfies PanelResponse))
  return true // keep the channel open for the async reply
})

const PANEL_REQUESTS = new Set<PanelRequest['type']>([
  'GET_CONTEXT',
  'RUN',
  'CANCEL',
  'FOCUS_ANCHOR',
  'CLEAR_PINS',
  'REQUEST_HOST_PERMISSION',
])

function isPanelRequest(msg: { type: string }): msg is PanelRequest {
  return PANEL_REQUESTS.has(msg.type as PanelRequest['type'])
}
