// One run, end to end: capture the page, ask the model, check the answer
// against the page, keep the result.
import { api } from '@/shared/browser'
import { emit, errorText, sendToTab, type ContentResponse } from '@/shared/messages'
import { getBackend } from '@/shared/backends'
import { BackendError } from '@/shared/backends/types'
import { groundAnalysis } from '@/shared/grounding'
import { resolvePersona } from '@/shared/personas'
import { endpointHost, getSettings, isOriginAllowed } from '@/shared/settings'
import type { Capture, Session } from '@/shared/types'
import { captureViewport } from './screenshot'
import { analysisKey, readCache, writeCache } from './cache'

let inFlight: AbortController | null = null

export function cancelRun(): void {
  inFlight?.abort()
  inFlight = null
}

export async function runAnalysis(
  tab: chrome.tabs.Tab,
  personaId: string,
  goal: string,
): Promise<Session> {
  const settings = await getSettings()
  const origin = new URL(tab.url ?? '').origin

  // The gate. Everything past this point sends the developer's page somewhere.
  if (!isOriginAllowed(origin, settings)) {
    throw new Error(`${origin} is not on the list of origins that may be analysed.`)
  }

  const backend = getBackend(settings.activeBackendId)
  const config = settings.activeBackendId ? settings.backends[settings.activeBackendId] : undefined
  if (!backend || !config) {
    throw new Error('No model endpoint is configured yet. Open Settings to add one.')
  }

  await assertCanReachEndpoint(config.baseUrl)

  const persona = resolvePersona(personaId, settings.personas)
  if (!persona) {
    throw new Error('That person no longer exists. Pick someone else, or add them in Settings.')
  }

  const session: Session = {
    id: `run-${Date.now().toString(36)}`,
    origin,
    personaId,
    goal,
    startedAt: Date.now(),
    status: 'capturing',
    captures: [],
    backend: { id: backend.id, model: config.model },
  }

  emit({ type: 'PROGRESS', stage: 'capturing' })

  const capture = await captureTab(tab, config.vision)
  session.captures = [capture]

  // A mobile persona judging a desktop layout produces confident nonsense about
  // a page they would never have seen, so say so rather than answer anyway.
  if (persona.device === 'mobile' && capture.viewport.w > 700) {
    throw new Error(
      `${persona.name} uses a phone, but this window is ${capture.viewport.w}px wide. Switch to a phone-sized viewport, or pick a persona who uses a desktop.`,
    )
  }

  const request = { persona, goal, captures: session.captures }

  const hash = await analysisKey({
    nodes: capture.nodes,
    personaId,
    persona,
    goal,
    backendId: backend.id,
    model: config.model,
    hasScreenshot: Boolean(capture.screenshot),
  })

  const cached = await readCache(hash)
  if (cached) {
    session.status = 'done'
    session.analysis = cached
    return session
  }

  session.status = 'analyzing'
  emit({ type: 'PROGRESS', stage: 'analyzing', detail: `${config.model} at ${endpointHost(config)}` })

  inFlight = new AbortController()
  try {
    const raw = await backend.analyze(request, {
      config,
      signal: inFlight.signal,
      onProgress: (detail) => emit({ type: 'PROGRESS', stage: 'analyzing', detail }),
    })

    emit({ type: 'PROGRESS', stage: 'grounding' })
    const grounded = groundAnalysis(raw, session.captures)

    session.status = 'done'
    session.analysis = grounded
    await writeCache(hash, grounded)
    return session
  } catch (err) {
    if (err instanceof BackendError && err.detail) {
      throw new Error(`${err.message}\n\n${err.detail}`)
    }
    throw new Error(errorText(err))
  } finally {
    inFlight = null
  }
}

async function captureTab(tab: chrome.tabs.Tab, wantScreenshot: boolean): Promise<Capture> {
  const res: ContentResponse = await sendToTab(tab.id!, { type: 'CAPTURE' })
  if (res.type === 'ERROR') throw new Error(res.message)
  if (res.type !== 'CAPTURE') throw new Error('Unexpected reply from the page.')

  const screenshot = wantScreenshot && tab.windowId ? await captureViewport(tab.windowId) : null
  return { ...res.capture, screenshot: screenshot ?? undefined }
}

/**
 * The extension ships with no host access at all, so the first run against a
 * new endpoint would otherwise fail with an opaque network error.
 */
async function assertCanReachEndpoint(baseUrl: string): Promise<void> {
  let origin: string
  try {
    origin = new URL(baseUrl).origin
  } catch {
    throw new Error(`"${baseUrl}" is not a valid URL.`)
  }

  const granted = await api.permissions.contains({ origins: [`${origin}/*`] })
  if (!granted) {
    throw new Error(`NEEDS_PERMISSION:${origin}`)
  }
}
