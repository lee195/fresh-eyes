// The personas a developer actually has: the four shipped in code, plus the
// ones they add or change.
//
// The store holds *deltas*, not the whole set. An entry whose id matches a
// shipped persona replaces it; deleting that entry brings the shipped one back.
// Two things follow from that, and both are the reason for it: an edited
// default is never lost beyond recovery, and a later release that improves the
// shipped wording still reaches everyone who never touched it.
//
// Ids are permanent. A Session names its persona by id and the analysis cache
// keys on it, so renaming "Margaret, 68" to "Margaret, 71" keeps the id
// `margaret` and keeps old runs interpretable.
import type { Device, Patience, Persona, TechLevel } from '@/shared/types'
import { DEFAULT_PERSONAS } from './defaults'

export { DEFAULT_PERSONAS, personaById } from './defaults'

/** Custom and edited personas, by id. This is `Settings.personas`. */
export type PersonaStore = Record<string, Persona>

/**
 * Every field here is pasted verbatim into the prompt, ahead of the page model.
 * Unbounded text does not make a persona sharper — it crowds out the page the
 * persona is supposed to be reacting to. These are generous but finite.
 */
export const LIMITS = {
  name: 60,
  context: 400,
  motivation: 240,
  quirk: 160,
  quirks: 10,
  word: 40,
  unknownWords: 40,
} as const

/** What the editor form holds: the same shape, before it has been trusted. */
export type PersonaDraft = Omit<Persona, 'custom'>

const PATIENCES: Patience[] = ['low', 'medium', 'high']
const DEVICES: Device[] = ['desktop', 'mobile']

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Shipped personas first, in their code order, then custom ones as added. */
export function listPersonas(store: PersonaStore | undefined): Persona[] {
  const overrides = store ?? {}
  const shipped = DEFAULT_PERSONAS.map((p) => overrides[p.id] ?? p)
  const custom = Object.entries(overrides)
    .filter(([id]) => !isShipped(id))
    .map(([, p]) => p)
  return [...shipped, ...custom]
}

export function resolvePersona(
  id: string,
  store: PersonaStore | undefined,
): Persona | undefined {
  return store?.[id] ?? DEFAULT_PERSONAS.find((p) => p.id === id)
}

/** True when this id names one of the four that ship in code. */
export function isShipped(id: string): boolean {
  return DEFAULT_PERSONAS.some((p) => p.id === id)
}

/** True when a shipped persona has been edited and can be reset. */
export function isEdited(id: string, store: PersonaStore | undefined): boolean {
  return isShipped(id) && Boolean(store?.[id])
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Trim, drop empties, dedupe, clamp. Never throws and never rejects: a value
 * the UI cannot produce can still arrive from an older stored persona, and a
 * usable persona beats an error about a field the developer cannot see.
 */
export function normalizePersona(draft: PersonaDraft): Persona {
  return {
    id: draft.id,
    name: clamp(draft.name, LIMITS.name),
    context: clamp(draft.context, LIMITS.context),
    techLevel: (Math.min(5, Math.max(1, Math.round(Number(draft.techLevel) || 3))) as TechLevel),
    patience: PATIENCES.includes(draft.patience) ? draft.patience : 'medium',
    device: DEVICES.includes(draft.device) ? draft.device : 'desktop',
    motivation: clamp(draft.motivation, LIMITS.motivation),
    quirks: cleanList(draft.quirks, LIMITS.quirk, LIMITS.quirks),
    unknownWords: cleanList(draft.unknownWords, LIMITS.word, LIMITS.unknownWords),
    custom: true,
  }
}

/**
 * Field name → what is wrong with it. Empty when the draft can be saved.
 *
 * Only the fields that carry the persona are required. techLevel, patience and
 * device come from selects and are repaired by `normalizePersona` rather than
 * refused.
 */
export function validatePersona(draft: PersonaDraft): Record<string, string> {
  const persona = normalizePersona(draft)
  const problems: Record<string, string> = {}

  if (!persona.name) problems.name = 'Give this person a name.'
  if (!persona.context) {
    problems.context = 'A sentence of life context is what makes the voice specific.'
  }
  if (!persona.motivation) {
    problems.motivation = 'Why they are here decides how much friction they will absorb.'
  }
  if (!persona.quirks.length) {
    problems.quirks = 'At least one thing they do — this is what turns into behaviour.'
  }

  return problems
}

/**
 * A slug of the name, kept unique against both the store and the shipped ids.
 *
 * Called once, when a persona is created. Renaming later does not change it.
 */
export function makePersonaId(name: string, store: PersonaStore | undefined): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'person'

  const taken = (id: string) => Boolean(store?.[id]) || isShipped(id)
  if (!taken(base)) return base

  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!taken(candidate)) return candidate
  }
}

/**
 * A detached, plain copy.
 *
 * Written out field by field rather than with `structuredClone`, which throws
 * `DataCloneError` on a Vue reactive proxy — and every persona that reaches
 * this module from a panel or an options page has come out of a `ref`, so it is
 * a proxy. Proxies must not reach `chrome.storage` either. A persona is one
 * level of nesting deep; there is nothing here worth being clever about.
 */
export function copyPersona(persona: Persona | PersonaDraft): PersonaDraft {
  return {
    id: persona.id,
    name: persona.name,
    context: persona.context,
    techLevel: persona.techLevel,
    patience: persona.patience,
    device: persona.device,
    motivation: persona.motivation,
    quirks: [...persona.quirks],
    unknownWords: [...persona.unknownWords],
  }
}

/** An empty persona, pre-filled with the least surprising defaults. */
export function blankPersona(): PersonaDraft {
  return {
    id: '',
    name: '',
    context: '',
    techLevel: 3,
    patience: 'medium',
    device: 'desktop',
    motivation: '',
    quirks: [],
    unknownWords: [],
  }
}

export function savePersona(store: PersonaStore, draft: PersonaDraft): PersonaStore {
  const persona = normalizePersona(draft)
  const id = persona.id || makePersonaId(persona.name, store)
  return { ...plainStore(store), [id]: { ...persona, id } }
}

/**
 * Removes the stored entry. For a custom persona that deletes it; for an edited
 * shipped one it restores the version in code — which is why the UI calls the
 * second of those "Reset" and not "Delete".
 */
export function forgetPersona(store: PersonaStore, id: string): PersonaStore {
  const next = plainStore(store)
  delete next[id]
  return next
}

/** A copy under a new id, so a shipped persona can be a starting point. */
export function duplicatePersona(store: PersonaStore, source: Persona): PersonaDraft {
  const name = clamp(`${source.name} (copy)`, LIMITS.name)
  return { ...copyPersona(source), id: makePersonaId(name, store), name }
}

// ---------------------------------------------------------------------------

/**
 * The store as plain data, ready for `chrome.storage`. Whatever came in — a
 * reactive proxy from an options page, a persona stored by an older build — what
 * goes back out is a normalized object the storage layer can serialize.
 */
function plainStore(store: PersonaStore): PersonaStore {
  const out: PersonaStore = {}
  for (const [id, persona] of Object.entries(store)) {
    out[id] = { ...normalizePersona(copyPersona(persona)), id }
  }
  return out
}

function clamp(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function cleanList(values: unknown, maxItem: number, maxItems: number): string[] {
  if (!Array.isArray(values)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const item = clamp(value, maxItem)
    if (!item) continue
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
    if (out.length === maxItems) break
  }
  return out
}
