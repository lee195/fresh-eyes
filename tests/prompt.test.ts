// Built from a capture taken by the real content script against
// fixtures/hostile.html in a real browser, so these assertions are about what
// a model would actually be handed rather than about a hand-written mock.
import { describe, expect, it } from 'vitest'
import { buildUserPrompt } from '@/shared/prompt'
import { personaById } from '@/shared/personas/defaults'
import type { Capture } from '@/shared/types'
import hostile from './fixtures/hostile-capture.json'

const capture = hostile as unknown as Capture
const margaret = personaById('margaret')!

const prompt = buildUserPrompt({
  persona: margaret,
  goal: 'Sign up for an account',
  captures: [capture],
})

describe('buildUserPrompt', () => {
  it('gives every element an id the model can anchor a reaction to', () => {
    for (const node of capture.nodes) expect(prompt).toContain(`[${node.id}]`)
  })

  it('says which fields have no label', () => {
    // Six fields, none of them labelled — the single biggest problem on this
    // page, and invisible unless the prompt states it.
    expect(prompt.match(/no label attached/g)?.length).toBe(6)
  })

  it('flags the button that cannot be focused', () => {
    expect(prompt).toMatch(/\[fe-11\].*Initialize.*looks clickable but cannot be focused/)
  })

  it('calls out the tiny faint legal text', () => {
    expect(prompt).toMatch(/10px text/)
    expect(prompt).toMatch(/very faint \(1\.7:1\)/)
  })

  it('names the card fields by their placeholders', () => {
    expect(prompt).toContain('placeholder "Card number"')
    expect(prompt).toContain('placeholder "CVC"')
  })

  it("carries the persona's vocabulary gap, which is what drives the reactions", () => {
    expect(prompt).toContain('Words they do not know')
    expect(prompt).toContain('provision')
    expect(prompt).toContain('workspace')
  })

  it('states the goal', () => {
    expect(prompt).toContain('Sign up for an account')
  })

  it('offers the felt signals as quotable evidence', () => {
    expect(prompt).toContain('HOW THE PAGE BEHAVED')
    expect(prompt).toContain('1 thing on the page looks clickable but cannot be reached')
    expect(prompt).toContain('the smallest text is 10 pixels')
  })

  it('says nothing about speed when the page was fast', () => {
    // This fixture painted in 52ms. Offering that as a "signal" would hand the
    // model a line to reach for once it has run out of real problems.
    expect(prompt).not.toMatch(/seconds/)
  })

  it('stays small enough to be cheap', () => {
    // A page model that costs more than the answer defeats the purpose.
    expect(Math.round(prompt.length / 4)).toBeLessThan(3000)
  })
})
