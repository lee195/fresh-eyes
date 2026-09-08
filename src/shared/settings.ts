// Persisted settings, and the origin allowlist that gates every capture.
//
// Storage is `local`, never `sync`: this object can hold an API key, and a key
// that syncs is a key that has left the machine.
import { api } from './browser'

export interface BackendConfig {
  /** Base URL of an OpenAI-compatible server, or the Anthropic API root. */
  baseUrl: string
  model: string
  /** Empty for a local server that needs no auth (Ollama, vLLM). */
  apiKey: string
  /** Endpoints cannot be probed reliably, so the dev tells us. */
  vision: boolean
  /** Send `response_format: json_schema`. Off for servers that reject it. */
  structuredOutput: boolean
}

export interface Settings {
  /** Origin patterns that may be captured without a confirmation prompt. */
  allowlist: string[]
  /** Origins the dev confirmed once, by hand. */
  confirmedOrigins: string[]
  activeBackendId: string | null
  backends: Record<string, BackendConfig>
  /** Custom and edited personas. Defaults live in code. */
  personas: Record<string, unknown>
  /** Show the dropped-reaction detail and the raw page model. */
  debug: boolean
}

/**
 * Localhost by default and nothing else. The extension ships a screenshot and
 * the text of the page to a configured endpoint; doing that to a production or
 * customer origin should be a deliberate act, not an accident of which tab was
 * focused.
 */
export const DEFAULT_ALLOWLIST = [
  'http://localhost',
  'http://127.0.0.1',
  'http://*.localhost',
  'http://*.local',
  'https://localhost',
  'https://127.0.0.1',
]

export const DEFAULT_SETTINGS: Settings = {
  allowlist: [...DEFAULT_ALLOWLIST],
  confirmedOrigins: [],
  activeBackendId: null,
  backends: {},
  personas: {},
  debug: false,
}

const KEY = 'fresh-eyes:settings'

export async function getSettings(): Promise<Settings> {
  const stored = await api.storage.local.get(KEY)
  return { ...DEFAULT_SETTINGS, ...((stored[KEY] as Partial<Settings>) ?? {}) }
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch }
  await api.storage.local.set({ [KEY]: next })
  return next
}

/**
 * Matches an origin against one allowlist pattern.
 *
 * Ports are ignored — a dev server's port changes constantly and no one wants
 * to maintain a list of them. A `*.` prefix matches one or more leading labels,
 * so `http://*.localhost` covers `http://app.localhost` but never
 * `http://localhost.evil.com`, which is the case worth being careful about.
 */
export function originMatches(origin: string, pattern: string): boolean {
  let url: URL
  let pat: URL
  try {
    url = new URL(origin)
    pat = new URL(pattern)
  } catch {
    return false
  }
  if (url.protocol !== pat.protocol) return false

  const host = url.hostname.toLowerCase()
  const patHost = pat.hostname.toLowerCase()

  if (patHost.startsWith('*.')) {
    const suffix = patHost.slice(1) // ".localhost"
    return host.endsWith(suffix) && host.length > suffix.length
  }
  return host === patHost
}

export function isOriginAllowed(origin: string, settings: Settings): boolean {
  if (settings.confirmedOrigins.includes(origin)) return true
  return settings.allowlist.some((p) => originMatches(origin, p))
}

/** The host an analysis request would be sent to, for display next to the run button. */
export function endpointHost(config: BackendConfig | undefined): string {
  if (!config?.baseUrl) return ''
  try {
    return new URL(config.baseUrl).host
  } catch {
    return config.baseUrl
  }
}

/** Never show a key back to the user; show enough to tell two keys apart. */
export function maskKey(key: string): string {
  if (!key) return ''
  return `••••${key.slice(-4)}`
}
