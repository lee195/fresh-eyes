// Persisted settings, and the origin allowlist that gates every capture.
//
// Storage is `local`, never `sync`: this object can hold an API key, and a key
// that syncs is a key that has left the machine.
import { api } from './browser'
import type { PersonaStore } from './personas'

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
  /** Custom and edited personas, by id. Defaults live in code; this holds deltas. */
  personas: PersonaStore
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

/** Exported so the panel can tell this key's change from any other. */
export const SETTINGS_KEY = 'fresh-eyes:settings'

export async function getSettings(): Promise<Settings> {
  const stored = await api.storage.local.get(SETTINGS_KEY)
  return { ...DEFAULT_SETTINGS, ...((stored[SETTINGS_KEY] as Partial<Settings>) ?? {}) }
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch }
  await api.storage.local.set({ [SETTINGS_KEY]: next })
  return next
}

/** A host is the same host with a trailing root dot or a different case. */
function canonicalHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '')
}

/**
 * Canonical form of an allowlist pattern, or null if it cannot be one.
 *
 * The address bar hides `https://`, so a host copied straight out of it arrives
 * scheme-less and `new URL` rejects it. Defaulting that to https beats dropping
 * it at match time, where the failure is invisible: the pattern is still listed
 * in the options page, so it looks saved while matching nothing.
 */
export function normalizePattern(input: string): string | null {
  // Zero-width characters and the BOM survive .trim() and ride along in a paste
  // from a doc or a wiki, leaving a pattern that is wrong and looks right.
  const trimmed = input.replace(/[\u200b-\u200f\u2060\ufeff]/g, '').trim()
  if (!trimmed) return null

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withScheme)
    const host = canonicalHost(url.hostname)
    if (!host) return null
    return `${url.protocol}//${host}`
  } catch {
    return null
  }
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
  const normalized = normalizePattern(pattern)
  if (!normalized) return false

  let url: URL
  let pat: URL
  try {
    url = new URL(origin)
    pat = new URL(normalized)
  } catch {
    return false
  }
  if (url.protocol !== pat.protocol) return false

  const host = canonicalHost(url.hostname)
  const patHost = pat.hostname.toLowerCase()

  if (patHost.startsWith('*.')) {
    const suffix = patHost.slice(1) // ".localhost"
    return host.endsWith(suffix) && host.length > suffix.length
  }
  return host === patHost
}

/**
 * The host match pattern to ask Chrome for, so an allowlisted origin can be
 * read and injected into after the `activeTab` grant has lapsed.
 *
 * Only http and https: those are what `optional_host_permissions` declares, and
 * a scheme we cannot request is better refused here than at the prompt.
 */
export function matchPatternFor(pattern: string): string | null {
  const normalized = normalizePattern(pattern)
  if (!normalized) return null
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) return null
  return `${normalized}/*`
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
