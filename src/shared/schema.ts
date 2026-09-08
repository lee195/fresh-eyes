// The contract with the model, and a parser that does not trust it.
//
// Two jobs. First, the JSON Schema handed to whichever endpoint supports
// structured output. Second — and more important — a validator run on whatever
// comes back regardless, because "OpenAI-compatible" servers vary wildly in how
// much of the schema they actually honour, and several honour none of it.
import {
  CAUSES,
  CONFIDENCE,
  FEELINGS,
  OUTCOMES,
  USER_ACTIONS,
  type AnalysisResult,
  type Reaction,
  type Verdict,
} from './types'

export const ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reactions', 'verdict'],
  properties: {
    reactions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['seq', 'anchorId', 'quote', 'feeling', 'action', 'cause', 'severity', 'evidence'],
        properties: {
          seq: { type: 'integer', minimum: 1, description: 'Order in which they noticed things.' },
          anchorId: {
            type: ['string', 'null'],
            description: 'The id of the page element that caused this, or null for the page overall.',
          },
          quote: {
            type: 'string',
            description: "First person, in this person's own words. Not a description of them.",
          },
          feeling: { type: 'string', enum: [...FEELINGS] },
          action: { type: 'string', enum: [...USER_ACTIONS] },
          cause: { type: 'string', enum: [...CAUSES] },
          severity: { type: 'integer', minimum: 1, maximum: 5 },
          evidence: {
            type: 'string',
            description: 'Text copied verbatim from the page model. Not paraphrased.',
          },
        },
      },
    },
    verdict: {
      type: 'object',
      additionalProperties: false,
      required: ['outcome', 'abandonedAtSeq', 'summary', 'topFixes', 'confidence'],
      properties: {
        outcome: { type: 'string', enum: [...OUTCOMES] },
        abandonedAtSeq: { type: ['integer', 'null'] },
        summary: { type: 'string' },
        topFixes: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['fix', 'addressesSeq'],
            properties: {
              fix: { type: 'string' },
              addressesSeq: { type: 'array', items: { type: 'integer' } },
            },
          },
        },
        confidence: { type: 'string', enum: [...CONFIDENCE] },
      },
    },
  },
} as const

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export type ParseResult =
  | { ok: true; value: AnalysisResult }
  | { ok: false; error: string; raw: string }

/**
 * Pulls a JSON object out of a model response.
 *
 * Even with a schema attached, smaller local models routinely wrap the object
 * in a fence, prefix it with "Here is the analysis:", or append a note. Failing
 * the whole run over that would make the extension unusable against exactly the
 * free local endpoint we recommend people start with.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim()

  try {
    return JSON.parse(trimmed)
  } catch {
    // Fall through to the fenced and embedded cases.
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim())
    } catch {
      // Fall through.
    }
  }

  // Last resort: the outermost braces. Scans for a balanced pair rather than
  // taking first-to-last, which breaks on any trailing prose containing "}".
  const start = trimmed.indexOf('{')
  if (start !== -1) {
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i]!
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') inString = !inString
      if (inString) continue
      if (ch === '{') depth++
      else if (ch === '}' && --depth === 0) {
        try {
          return JSON.parse(trimmed.slice(start, i + 1))
        } catch {
          break
        }
      }
    }
  }

  throw new Error('No JSON object found in the response.')
}

/** Validates shape and vocabulary. Anything malformed is rejected, not repaired. */
export function parseAnalysis(text: string, captureId: string): ParseResult {
  let data: unknown
  try {
    data = extractJson(text)
  } catch (err) {
    return { ok: false, error: (err as Error).message, raw: text }
  }

  const root = data as Record<string, unknown>
  if (!root || typeof root !== 'object') {
    return { ok: false, error: 'Response was not an object.', raw: text }
  }
  if (!Array.isArray(root.reactions)) {
    return { ok: false, error: 'Response had no reactions array.', raw: text }
  }

  const reactions: Reaction[] = []
  for (const item of root.reactions) {
    const reaction = coerceReaction(item, captureId)
    if (reaction) reactions.push(reaction)
  }

  const verdict = coerceVerdict(root.verdict)
  if (!verdict) return { ok: false, error: 'Response had no usable verdict.', raw: text }

  return { ok: true, value: { reactions, verdict } }
}

function coerceReaction(input: unknown, captureId: string): Reaction | null {
  if (!input || typeof input !== 'object') return null
  const r = input as Record<string, unknown>

  const quote = str(r.quote)
  const feeling = oneOf(r.feeling, FEELINGS)
  const action = oneOf(r.action, USER_ACTIONS)
  const cause = oneOf(r.cause, CAUSES)
  if (!quote || !feeling || !action || !cause) return null

  const seq = int(r.seq)
  if (seq === null) return null

  return {
    seq,
    captureId,
    anchorId: typeof r.anchorId === 'string' && r.anchorId ? r.anchorId : null,
    quote,
    feeling,
    action,
    cause,
    severity: clampSeverity(int(r.severity) ?? 3),
    evidence: str(r.evidence) ?? '',
  }
}

function coerceVerdict(input: unknown): Verdict | null {
  if (!input || typeof input !== 'object') return null
  const v = input as Record<string, unknown>

  const outcome = oneOf(v.outcome, OUTCOMES)
  if (!outcome) return null

  const fixes = Array.isArray(v.topFixes) ? v.topFixes : []

  return {
    outcome,
    abandonedAtSeq: int(v.abandonedAtSeq),
    summary: str(v.summary) ?? '',
    topFixes: fixes
      .map((f) => {
        const fix = str((f as Record<string, unknown>)?.fix)
        if (!fix) return null
        const seqs = (f as Record<string, unknown>)?.addressesSeq
        return {
          fix,
          addressesSeq: Array.isArray(seqs)
            ? seqs.map((s) => int(s)).filter((s): s is number => s !== null)
            : [],
        }
      })
      .filter((f): f is { fix: string; addressesSeq: number[] } => f !== null),
    confidence: oneOf(v.confidence, CONFIDENCE) ?? 'low',
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function int(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value)
  return null
}

function oneOf<T extends readonly string[]>(value: unknown, allowed: T): T[number] | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : null
}

function clampSeverity(n: number): 1 | 2 | 3 | 4 | 5 {
  return Math.min(5, Math.max(1, n)) as 1 | 2 | 3 | 4 | 5
}
