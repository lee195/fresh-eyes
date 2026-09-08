// The backend registry.
//
// Everything above this file addresses a backend by id and never imports a
// concrete one. Adding a provider means adding a module here and nothing else.
import type { ModelBackend } from './types'
import { openAiCompatBackend } from './openai-compat'
import { anthropicBackend } from './anthropic'

export const BACKENDS: ModelBackend[] = [openAiCompatBackend, anthropicBackend]

/** The one a fresh install offers first — local, free, and nothing leaves the machine. */
export const DEFAULT_BACKEND_ID = openAiCompatBackend.id

export function getBackend(id: string | null | undefined): ModelBackend | undefined {
  return BACKENDS.find((b) => b.id === id)
}

export * from './types'
