// Checks that every reaction is about something that was actually on the page.
//
// A vision model asked to play a confused user will confidently invent the UI a
// confused user would struggle with: a cookie banner that is not there, a
// "Continue" button that does not exist. Those reactions read *better* than the
// real ones, which is exactly why they are dangerous — a developer who chases
// one invented problem stops trusting the tool for good.
//
// So nothing is repaired here. A reaction that cites UI we did not capture is
// dropped, and the count of drops is shown. A tool that quietly fixes up the
// model's mistakes is a tool whose output you cannot reason about.
import type { AnalysisResult, Capture, GroundedAnalysis, Reaction } from './types'
import { TERMINAL_ACTIONS } from './types'

/** Below this, the evidence is not a quote from the page — it is a paraphrase. */
const SIMILARITY_THRESHOLD = 0.8

export function groundAnalysis(result: AnalysisResult, captures: Capture[]): GroundedAnalysis {
  const anchors = new Set<string>()
  for (const capture of captures) {
    for (const node of capture.nodes) anchors.add(node.id)
  }

  const corpus = buildCorpus(captures)
  const joined = corpus.join('  ')

  const kept: Reaction[] = []
  const discarded: GroundedAnalysis['discarded'] = []
  const seenSeq = new Set<number>()

  for (const reaction of result.reactions) {
    const why = rejectionReason(reaction, anchors, corpus, joined, seenSeq)
    if (why) {
      discarded.push({ reaction, why })
      continue
    }
    seenSeq.add(reaction.seq)
    kept.push(reaction)
  }

  kept.sort((a, b) => a.seq - b.seq)

  return {
    ...result,
    reactions: kept,
    verdict: reconcileVerdict(result.verdict, kept),
    discarded,
  }
}

function rejectionReason(
  reaction: Reaction,
  anchors: Set<string>,
  corpus: string[],
  joined: string,
  seenSeq: Set<number>,
): string | null {
  if (seenSeq.has(reaction.seq)) {
    return `Duplicate position ${reaction.seq} — two things cannot both be noticed ${reaction.seq}th.`
  }
  if (reaction.anchorId !== null && !anchors.has(reaction.anchorId)) {
    return `Cites element ${reaction.anchorId}, which is not on the page.`
  }
  if (!reaction.evidence.trim()) {
    return 'No evidence quoted, so there is no way to tell whether this is about the page.'
  }
  if (!isQuoted(reaction.evidence, corpus, joined)) {
    return `Quotes text that does not appear on the page: "${truncate(reaction.evidence)}".`
  }
  return null
}

/**
 * Is this evidence string genuinely present in what we captured?
 *
 * Exact containment first, since a well-behaved model copies verbatim. The
 * fuzzy fallback exists because models reflow whitespace and drop trailing
 * punctuation, and failing a real reaction over a missing full stop would push
 * developers to switch the check off.
 */
export function isQuoted(evidence: string, corpus: string[], joined: string): boolean {
  const needle = normalize(evidence)
  if (!needle) return false
  if (joined.includes(needle)) return true

  // Containment, not similarity: the evidence is usually a short phrase and the
  // corpus entry it came from is often a long paragraph. Comparing the two as
  // whole strings would score almost zero for a quote that is genuinely inside
  // the text, so the question asked is "how much of the quote appears here",
  // not "how alike are these two strings".
  return corpus.some((entry) => trigramContainment(needle, entry) >= SIMILARITY_THRESHOLD)
}

/**
 * Everything the model was allowed to have seen.
 *
 * Includes rendered statements of the felt signals, so that a reaction about
 * waiting or about a broken page has something legitimate to cite. Without
 * them, every page-level observation would fail grounding and the tool would
 * only ever report problems that are literally written on the page.
 */
export function buildCorpus(captures: Capture[]): string[] {
  const entries: string[] = []

  for (const capture of captures) {
    entries.push(normalize(capture.title))

    for (const node of capture.nodes) {
      if (node.text) entries.push(normalize(node.text))
      if (node.name) entries.push(normalize(node.name))
      if (node.state?.placeholder) entries.push(normalize(node.state.placeholder))
      if (node.state?.validationMessage) entries.push(normalize(node.state.validationMessage))
    }

    for (const statement of signalStatements(capture)) entries.push(normalize(statement))
  }

  return entries.filter(Boolean)
}

/** The felt signals, in words the model can quote back. */
export function signalStatements(capture: Capture): string[] {
  const s = capture.signals
  const out: string[] = []

  // Timings are only mentioned once they are long enough to be felt. Telling
  // the model a page appeared in 0.1s invites a reaction about speed where
  // there is nothing to react to — and every such line is one the model may
  // reach for when it has run out of real problems.
  if (s.lcpMs !== undefined && s.lcpMs > 2500) {
    out.push(`the page took ${(s.lcpMs / 1000).toFixed(1)} seconds to finish appearing`)
  }
  if (s.fcpMs !== undefined && s.fcpMs > 1500) {
    out.push(`nothing at all was on screen for the first ${(s.fcpMs / 1000).toFixed(1)} seconds`)
  }
  if (s.cls > 0.1) out.push('the page moved around while loading')
  if (s.pageErrors > 0) {
    out.push(`something on the page is broken (${s.pageErrors} ${plural(s.pageErrors, 'error')})`)
  }
  if (s.fakeClickables > 0) {
    const n = s.fakeClickables
    out.push(
      `${n} ${plural(n, 'thing')} on the page ${n === 1 ? 'looks' : 'look'} clickable but cannot be reached`,
    )
  }
  if (s.smallestFontPx > 0 && s.smallestFontPx <= 12) out.push(`the smallest text is ${s.smallestFontPx} pixels`)
  if (s.worstContrastRatio !== undefined && s.worstContrastRatio < 4.5) {
    out.push(`the faintest text has a contrast of ${s.worstContrastRatio} to 1`)
  }
  if (s.longestTextBlockChars > 400) out.push(`the longest paragraph is ${s.longestTextBlockChars} characters`)

  return out
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`
}

/**
 * Makes the verdict agree with the reactions that survived.
 *
 * The abandonment point drives the panel's most important piece of UI — the
 * line under which nothing was ever seen. If the model's `abandonedAtSeq`
 * points at a reaction that grounding removed, that line would be drawn in the
 * wrong place, so the surviving reactions decide it.
 */
function reconcileVerdict(
  verdict: AnalysisResult['verdict'],
  kept: Reaction[],
): AnalysisResult['verdict'] {
  const firstTerminal = kept.find((r) => TERMINAL_ACTIONS.includes(r.action))

  if (!firstTerminal) {
    // Nothing survived that says they left, so the page cannot be reported as
    // abandoned no matter what the model concluded.
    return {
      ...verdict,
      outcome: verdict.outcome === 'abandoned' ? 'completed_with_friction' : verdict.outcome,
      abandonedAtSeq: null,
    }
  }

  return { ...verdict, outcome: 'abandoned', abandonedAtSeq: firstTerminal.seq }
}

// ---------------------------------------------------------------------------
// Text comparison
// ---------------------------------------------------------------------------

export function normalize(text: string): string {
  return (
    text
      .toLowerCase()
      // Curly apostrophes are folded rather than stripped: the apostrophe is
      // part of the word, and "dont" should not match "don't" by accident.
      // Quotation marks are dropped outright — they are delimiters a model
      // adds or omits freely, and keeping them leaves stray gaps in the
      // normalised text that shift an otherwise exact match.
      .replace(/[‘’]/g, "'")
      .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/**
 * What fraction of `needle`'s character trigrams also occur in `haystack`.
 *
 * Character trigrams rather than words so that reflowed whitespace, a dropped
 * comma or a changed suffix cost a little instead of everything.
 */
export function trigramContainment(needle: string, haystack: string): number {
  if (!needle) return 0
  if (haystack.includes(needle)) return 1
  if (needle.length < 3) return haystack.includes(needle) ? 1 : 0

  const wanted = trigrams(needle)
  const available = trigrams(haystack)
  let shared = 0

  for (const [gram, count] of wanted) {
    const other = available.get(gram)
    if (other) shared += Math.min(count, other)
  }

  const total = size(wanted)
  return total === 0 ? 0 : shared / total
}

function trigrams(text: string): Map<string, number> {
  const map = new Map<string, number>()
  for (let i = 0; i <= text.length - 3; i++) {
    const gram = text.slice(i, i + 3)
    map.set(gram, (map.get(gram) ?? 0) + 1)
  }
  return map
}

function size(map: Map<string, number>): number {
  let total = 0
  for (const count of map.values()) total += count
  return total
}

function truncate(text: string): string {
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}
