import { describe, expect, it } from 'vitest'
import { extractJson, parseAnalysis } from '@/shared/schema'

const VALID = {
  reactions: [
    {
      seq: 1,
      anchorId: 'fe-1',
      quote: "What's a workspace?",
      feeling: 'confused',
      action: 'hesitates',
      cause: 'jargon',
      severity: 4,
      evidence: 'Provision your workspace instance',
    },
  ],
  verdict: {
    outcome: 'abandoned',
    abandonedAtSeq: 1,
    summary: 'She left at the heading.',
    topFixes: [{ fix: 'Say what the page is for.', addressesSeq: [1] }],
    confidence: 'high',
  },
}

describe('extractJson', () => {
  it('reads a bare object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('reads an object inside a code fence', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('reads an object a chatty model introduced first', () => {
    // Local models do this constantly, and failing the run over it would make
    // the free local endpoint — the one people try first — look broken.
    expect(extractJson('Here is the analysis:\n{"a":1}\nHope that helps!')).toEqual({ a: 1 })
  })

  it('is not confused by a closing brace inside a string', () => {
    expect(extractJson('{"a":"} not the end","b":2}')).toEqual({ a: '} not the end', b: 2 })
  })

  it('throws when there is no object at all', () => {
    expect(() => extractJson('I cannot help with that.')).toThrow(/No JSON object/)
  })
})

describe('parseAnalysis', () => {
  it('accepts a well-formed answer and stamps the capture on each reaction', () => {
    const result = parseAnalysis(JSON.stringify(VALID), 'cap-7')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.reactions[0]?.captureId).toBe('cap-7')
    expect(result.value.verdict.outcome).toBe('abandoned')
  })

  it('drops a reaction using a word outside the vocabulary', () => {
    // The closed enums are what make runs comparable. A model that invents
    // "action": "sighs" gets that reaction dropped rather than the whole run.
    const payload = structuredClone(VALID)
    payload.reactions.push({ ...VALID.reactions[0]!, seq: 2, action: 'sighs_audibly' })

    const result = parseAnalysis(JSON.stringify(payload), 'cap-1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.reactions).toHaveLength(1)
  })

  it('pulls severity back into range instead of failing', () => {
    const payload = structuredClone(VALID)
    payload.reactions[0]!.severity = 9

    const result = parseAnalysis(JSON.stringify(payload), 'cap-1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.reactions[0]?.severity).toBe(5)
  })

  it('rejects an answer with no usable verdict', () => {
    const result = parseAnalysis(JSON.stringify({ reactions: [], verdict: {} }), 'cap-1')
    expect(result.ok).toBe(false)
  })

  it('rejects a response that is not JSON at all', () => {
    const result = parseAnalysis('The page looks fine to me.', 'cap-1')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.raw).toContain('looks fine')
  })
})
