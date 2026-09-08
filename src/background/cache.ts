// Caches an analysis against the exact inputs that produced it.
//
// Developers re-open the panel constantly while working. Without this, glancing
// at the last verdict again costs another call to a metered endpoint, and the
// second answer differs slightly from the first for no reason the developer can
// see — which reads as the tool being unreliable rather than the model being
// sampled.
import { api } from '@/shared/browser'
import type { GroundedAnalysis } from '@/shared/types'

const KEY = 'fresh-eyes:cache'
const MAX_ENTRIES = 20

interface Entry {
  hash: string
  at: number
  analysis: GroundedAnalysis
}

/**
 * Everything that would change the answer, and nothing that would not.
 *
 * Scroll position and timestamps are excluded on purpose: scrolling the page
 * and re-running should hit the cache, because the person being simulated sees
 * the same page either way.
 */
export async function analysisKey(input: {
  nodes: unknown
  personaId: string
  persona: unknown
  goal: string
  backendId: string
  model: string
  hasScreenshot: boolean
}): Promise<string> {
  const material = JSON.stringify([
    input.nodes,
    input.personaId,
    input.persona,
    input.goal.trim().toLowerCase(),
    input.backendId,
    input.model,
    input.hasScreenshot,
  ])

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material))
  return Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function readCache(hash: string): Promise<GroundedAnalysis | null> {
  const entries = await allEntries()
  return entries.find((e) => e.hash === hash)?.analysis ?? null
}

export async function writeCache(hash: string, analysis: GroundedAnalysis): Promise<void> {
  const entries = (await allEntries()).filter((e) => e.hash !== hash)
  entries.unshift({ hash, at: Date.now(), analysis })
  await api.storage.local.set({ [KEY]: entries.slice(0, MAX_ENTRIES) })
}

export async function clearCache(): Promise<void> {
  await api.storage.local.remove(KEY)
}

async function allEntries(): Promise<Entry[]> {
  const stored = await api.storage.local.get(KEY)
  const entries = stored[KEY]
  return Array.isArray(entries) ? (entries as Entry[]) : []
}
