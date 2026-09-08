// The domain model. Every other module speaks in these terms.
//
// Shape note: a Session owns a *list* of Captures and every Reaction names the
// capture it belongs to. Today that list always has length 1 (single-page
// analysis). Journey recording — walking a signup flow across several pages —
// is then a longer list and a sequence-aware prompt, with no change here.

// ---------------------------------------------------------------------------
// What we captured from the page
// ---------------------------------------------------------------------------

/** Where an element sits relative to the first screenful. */
export type Fold = 'above' | 'below'

/**
 * One thing a person could perceive or act on.
 *
 * This is deliberately not a DOM node. Raw HTML is mostly invisible plumbing;
 * what a user reacts to is a much smaller set of visible, named, positioned
 * things. Everything here answers "what would they see or feel", not "what is
 * in the markup".
 */
export interface CapturedNode {
  /** Stable within one capture, e.g. "fe-7". The anchor for pins and citations. */
  id: string
  /** ARIA role, or inferred: button, link, heading, text, input, image, list. */
  role: string
  /** Accessible name, when the element has one. */
  name: string
  /** Visible text, whitespace-collapsed and truncated. */
  text: string
  tag: string
  box: { x: number; y: number; w: number; h: number }
  fold: Fold
  interactive: boolean
  /** Present for form controls. Values are never captured — see redaction. */
  state?: {
    disabled?: boolean
    required?: boolean
    invalid?: boolean
    validationMessage?: string
    placeholder?: string
    inputType?: string
    checked?: boolean
    hasLabel?: boolean
  }
  style: {
    fontSizePx: number
    /** Foreground/background contrast, when both could be resolved. */
    contrastRatio?: number
    /** Styled to look clickable but not actually interactive — a real trap. */
    looksClickable: boolean
  }
  /** nth-child path, used to re-find the element after the app re-renders. */
  path: string
  /** Parent node id, so the model can tell a label from a lone sentence. */
  parentId: string | null
}

/**
 * Things a user *feels* that no single element states: waiting, jitter,
 * breakage, walls of text. Collected separately because they are properties of
 * the page as an experience rather than of any one node.
 */
export interface CaptureSignals {
  /** Milliseconds to first contentful paint, when the navigation was observed. */
  fcpMs?: number
  /** Milliseconds to largest contentful paint. */
  lcpMs?: number
  /**
   * Cumulative layout shift — things moving under your finger. Always present:
   * unlike the paint timings, which may genuinely be unavailable, this starts
   * at zero and only accumulates.
   */
  cls: number
  /**
   * Uncaught errors and rejections seen since we attached. Read from `error`
   * events rather than by wrapping `console.error` — patching a global the app
   * owns would be visible to it, and uncaught errors are the ones a user
   * actually experiences as the page being broken.
   */
  pageErrors: number
  /** Elements styled clickable that do nothing. */
  fakeClickables: number
  /** Longest run of uninterrupted prose, in characters. */
  longestTextBlockChars: number
  /** Smallest font size actually rendering text, in px. */
  smallestFontPx: number
  /** Worst foreground/background contrast found among text nodes. */
  worstContrastRatio?: number
  /** True when the node budget clipped the model. */
  truncated: boolean
}

export interface Capture {
  id: string
  url: string
  /** Origin only — used for the allowlist check and for grouping history. */
  origin: string
  title: string
  capturedAt: number
  viewport: { w: number; h: number; dpr: number; scrollY: number; pageHeight: number }
  nodes: CapturedNode[]
  signals: CaptureSignals
  /** Downscaled JPEG data URL of the visible viewport. Absent if unavailable. */
  screenshot?: string
}

// ---------------------------------------------------------------------------
// Who is looking
// ---------------------------------------------------------------------------

export type TechLevel = 1 | 2 | 3 | 4 | 5
export type Patience = 'low' | 'medium' | 'high'
export type Device = 'desktop' | 'mobile'

/**
 * A persona is structured rather than a prose blob so the model gets consistent
 * leverage on each trait, and so a team can diff one in review.
 */
export interface Persona {
  id: string
  name: string
  /** One or two sentences of life context. "Retired teacher. iPad. Email and her bank app." */
  context: string
  techLevel: TechLevel
  patience: Patience
  device: Device
  /** Why they are here at all. Motivation decides how much friction they absorb. */
  motivation: string
  /** Concrete behavioural rules: "won't type card details before seeing a price". */
  quirks: string[]
  /** Words this person does not know. The single highest-signal field. */
  unknownWords: string[]
  /** False for the four shipped defaults, true once the user edits or adds one. */
  custom?: boolean
}

// ---------------------------------------------------------------------------
// What came back
// ---------------------------------------------------------------------------

// The vocabularies below are declared as runtime arrays and the types derived
// from them, so that the JSON schema sent to the model and the types checked at
// compile time can never drift apart.

export const FEELINGS = [
  'confused',
  'annoyed',
  'anxious',
  'bored',
  'reassured',
  'delighted',
] as const
export type Feeling = (typeof FEELINGS)[number]

/**
 * What the person *does*. This closed set is the product: it is what makes runs
 * comparable, filterable, and renderable as something other than prose. Free
 * text here would collapse the whole tool into a wall of opinions.
 */
export const USER_ACTIONS = [
  'reads_on',
  'hesitates',
  'rereads',
  'scrolls_past',
  'clicks_wrong_thing',
  'opens_new_tab_to_search',
  'switches_tab',
  'closes_page',
  'asks_someone_for_help',
  'abandons_task',
  'completes_step',
] as const
export type UserAction = (typeof USER_ACTIONS)[number]

/** Actions after which the person is no longer engaged with the task. */
export const TERMINAL_ACTIONS: readonly UserAction[] = [
  'closes_page',
  'abandons_task',
  'switches_tab',
] as const

export const CAUSES = [
  'jargon',
  'unclear_next_step',
  'trust',
  'cost_uncertainty',
  'wall_of_text',
  'slow',
  'error',
  'form_friction',
  'lost_in_nav',
  'visual_noise',
  'cant_find_it',
] as const
export type Cause = (typeof CAUSES)[number]

export type Severity = 1 | 2 | 3 | 4 | 5

export interface Reaction {
  /** Attention order. Reading this list top to bottom is the narrative. */
  seq: number
  captureId: string
  /** A CapturedNode id, or null when the reaction is about the page as a whole. */
  anchorId: string | null
  /** First person, in the persona's own voice. */
  quote: string
  feeling: Feeling
  action: UserAction
  cause: Cause
  severity: Severity
  /** Verbatim text from the capture that triggered this. Checked by grounding.ts. */
  evidence: string
}

export const OUTCOMES = ['completed', 'completed_with_friction', 'abandoned'] as const
export type Outcome = (typeof OUTCOMES)[number]

export const CONFIDENCE = ['low', 'medium', 'high'] as const

export interface Verdict {
  outcome: Outcome
  /** The seq at which they gave up, when they did. */
  abandonedAtSeq: number | null
  /** One sentence a dev can paste into a ticket. */
  summary: string
  topFixes: { fix: string; addressesSeq: number[] }[]
  confidence: (typeof CONFIDENCE)[number]
}

/** What the model returned, before grounding. */
export interface AnalysisResult {
  reactions: Reaction[]
  verdict: Verdict
  usage?: { inputTokens?: number; outputTokens?: number; usd?: number }
}

/** What grounding.ts produced from it. */
export interface GroundedAnalysis extends AnalysisResult {
  /** Reactions dropped for citing UI that was not on the page. */
  discarded: { reaction: Partial<Reaction>; why: string }[]
}

// ---------------------------------------------------------------------------
// A run
// ---------------------------------------------------------------------------

export type SessionStatus = 'capturing' | 'analyzing' | 'done' | 'error'

export interface Session {
  id: string
  origin: string
  personaId: string
  /** What the persona was trying to do. "Sign up", "find out what it costs". */
  goal: string
  startedAt: number
  status: SessionStatus
  error?: string
  captures: Capture[]
  analysis?: GroundedAnalysis
  /** Which backend produced this, so history rows stay interpretable. */
  backend?: { id: string; model: string }
}
