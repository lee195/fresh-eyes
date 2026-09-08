import { describe, expect, it } from 'vitest'
import { buildCorpus, groundAnalysis, isQuoted, normalize, trigramContainment } from '@/shared/grounding'
import type { AnalysisResult, Capture, CapturedNode, Reaction } from '@/shared/types'

function node(id: string, text: string, extra: Partial<CapturedNode> = {}): CapturedNode {
  return {
    id,
    role: 'text',
    name: '',
    text,
    tag: 'p',
    box: { x: 0, y: 0, w: 100, h: 20 },
    fold: 'above',
    interactive: false,
    style: { fontSizePx: 16, looksClickable: false },
    path: `html > body:nth-child(2) > p:nth-child(1)`,
    parentId: null,
    ...extra,
  }
}

function capture(nodes: CapturedNode[], signals: Partial<Capture['signals']> = {}): Capture {
  return {
    id: 'cap-1',
    url: 'http://localhost:5173/signup',
    origin: 'http://localhost:5173',
    title: 'Create your account',
    capturedAt: 0,
    viewport: { w: 1280, h: 720, dpr: 1, scrollY: 0, pageHeight: 900 },
    nodes,
    signals: {
      cls: 0,
      pageErrors: 0,
      fakeClickables: 0,
      longestTextBlockChars: 0,
      smallestFontPx: 16,
      truncated: false,
      ...signals,
    },
  }
}

function reaction(over: Partial<Reaction> = {}): Reaction {
  return {
    seq: 1,
    captureId: 'cap-1',
    anchorId: 'fe-1',
    quote: "I don't know what that means.",
    feeling: 'confused',
    action: 'hesitates',
    cause: 'jargon',
    severity: 3,
    evidence: 'Provision your workspace instance',
    ...over,
  }
}

function analysis(reactions: Reaction[], over: Partial<AnalysisResult['verdict']> = {}): AnalysisResult {
  return {
    reactions,
    verdict: {
      outcome: 'completed_with_friction',
      abandonedAtSeq: null,
      summary: 'Got through it.',
      topFixes: [],
      confidence: 'medium',
      ...over,
    },
  }
}

const page = capture([node('fe-1', 'Provision your workspace instance')])

describe('groundAnalysis', () => {
  it('keeps a reaction that cites a real element and quotes real text', () => {
    const result = groundAnalysis(analysis([reaction()]), [page])
    expect(result.reactions).toHaveLength(1)
    expect(result.discarded).toHaveLength(0)
  })

  it('drops a reaction anchored to an element that was never on the page', () => {
    // The failure this whole module exists for: the model narrates a plausible
    // struggle with a button the page does not have.
    const result = groundAnalysis(analysis([reaction({ anchorId: 'fe-999' })]), [page])
    expect(result.reactions).toHaveLength(0)
    expect(result.discarded[0]?.why).toMatch(/not on the page/)
  })

  it('drops a reaction quoting text that does not appear anywhere', () => {
    const invented = reaction({
      anchorId: null,
      evidence: 'Accept all cookies to continue',
    })
    const result = groundAnalysis(analysis([invented]), [page])
    expect(result.reactions).toHaveLength(0)
    expect(result.discarded[0]?.why).toMatch(/does not appear on the page/)
  })

  it('drops a reaction with no evidence at all', () => {
    const result = groundAnalysis(analysis([reaction({ evidence: '  ' })]), [page])
    expect(result.reactions).toHaveLength(0)
    expect(result.discarded[0]?.why).toMatch(/No evidence/)
  })

  it('drops the second reaction claiming the same position', () => {
    const result = groundAnalysis(analysis([reaction({ seq: 1 }), reaction({ seq: 1 })]), [page])
    expect(result.reactions).toHaveLength(1)
    expect(result.discarded[0]?.why).toMatch(/Duplicate position/)
  })

  it('lets a reaction cite how the page behaved, not just what it says', () => {
    const slow = capture([node('fe-1', 'Provision your workspace instance')], { lcpMs: 6200 })
    const waiting = reaction({
      anchorId: null,
      cause: 'slow',
      evidence: 'the page took 6.2 seconds to appear',
    })
    const result = groundAnalysis(analysis([waiting]), [slow])
    expect(result.reactions).toHaveLength(1)
  })
})

describe('verdict reconciliation', () => {
  it('moves the abandonment point to the surviving reaction that ends the run', () => {
    // The model said they gave up at 5; grounding removed 5 as invented. The
    // panel draws its "never got this far" line from this number, so it has to
    // follow the reactions that survived rather than the ones that did not.
    const kept = [
      reaction({ seq: 1 }),
      reaction({ seq: 2, action: 'closes_page', evidence: 'Create your account' }),
    ]
    const result = groundAnalysis(analysis(kept, { outcome: 'abandoned', abandonedAtSeq: 5 }), [page])
    expect(result.verdict.abandonedAtSeq).toBe(2)
    expect(result.verdict.outcome).toBe('abandoned')
  })

  it('will not report an abandonment when nothing survived that says they left', () => {
    const result = groundAnalysis(
      analysis([reaction({ anchorId: 'fe-404', action: 'closes_page' })], {
        outcome: 'abandoned',
        abandonedAtSeq: 1,
      }),
      [page],
    )
    expect(result.verdict.outcome).toBe('completed_with_friction')
    expect(result.verdict.abandonedAtSeq).toBeNull()
  })
})

describe('isQuoted', () => {
  const long =
    'Acme is a multi-tenant orchestration substrate for distributed workloads. Each workspace is bound to an isolated namespace with its own quota envelope.'
  const corpus = buildCorpus([capture([node('fe-1', long)])])
  const joined = corpus.join('  ')

  it('accepts a short phrase lifted out of a long paragraph', () => {
    // Whole-string similarity would score this near zero, which is why the
    // check measures containment instead.
    expect(isQuoted('isolated namespace with its own quota envelope', corpus, joined)).toBe(true)
  })

  it('tolerates reflowed whitespace and dropped punctuation', () => {
    expect(isQuoted('multi-tenant   orchestration substrate', corpus, joined)).toBe(true)
  })

  it('rejects a plausible sentence that is not on the page', () => {
    expect(isQuoted('Your free trial has expired', corpus, joined)).toBe(false)
  })
})

describe('normalize', () => {
  it('flattens the differences that should not decide a match', () => {
    expect(normalize('  “Don’t   worry!”  ')).toBe("don't worry")
  })

  it('keeps the apostrophe, because it is part of the word', () => {
    expect(normalize("don't")).not.toBe(normalize('dont'))
  })
})

describe('trigramContainment', () => {
  it('is 1 for an exact substring and 0 for unrelated text', () => {
    expect(trigramContainment('quota envelope', 'its own quota envelope here')).toBe(1)
    expect(trigramContainment('zzzz qqqq', 'entirely different')).toBeLessThan(0.3)
  })
})
