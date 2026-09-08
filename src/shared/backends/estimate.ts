// A pre-run cost estimate, shown next to the run button.
//
// Deliberately approximate. The point is not accounting — it is that someone
// about to send a 400-node page to a metered endpoint sees roughly what it
// costs before they click, rather than after.
import type { AnalysisRequest } from '@/shared/prompt'
import { buildSystemPrompt, buildUserPrompt } from '@/shared/prompt'

/** Characters per token for English prose and short identifiers. */
const CHARS_PER_TOKEN = 4

/** A 1024px-wide screenshot, roughly, across the vision models in use. */
const IMAGE_TOKENS = 1_200

export function estimateTokens(req: AnalysisRequest, withImage: boolean): number {
  const text = buildSystemPrompt().length + buildUserPrompt(req).length
  const images = withImage && req.captures.some((c) => c.screenshot) ? IMAGE_TOKENS : 0
  return Math.round(text / CHARS_PER_TOKEN) + images
}
