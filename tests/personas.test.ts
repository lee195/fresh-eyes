import { describe, expect, it } from 'vitest'
import { reactive, ref } from 'vue'
import {
  copyPersona,
  DEFAULT_PERSONAS,
  duplicatePersona,
  forgetPersona,
  isEdited,
  LIMITS,
  listPersonas,
  makePersonaId,
  normalizePersona,
  resolvePersona,
  savePersona,
  validatePersona,
  type PersonaDraft,
  type PersonaStore,
} from '@/shared/personas'

const draft = (over: Partial<PersonaDraft> = {}): PersonaDraft => ({
  id: '',
  name: 'Priya, 31',
  context: 'Runs the front desk at a dental practice.',
  techLevel: 2,
  patience: 'low',
  device: 'desktop',
  motivation: 'Her manager asked her to try it before Friday.',
  quirks: ['Keeps the phone ringing in one ear while she works'],
  unknownWords: ['webhook'],
  ...over,
})

describe('listPersonas', () => {
  it('shows the four shipped personas when nothing has been stored', () => {
    expect(listPersonas({}).map((p) => p.id)).toEqual(DEFAULT_PERSONAS.map((p) => p.id))
  })

  it('replaces a shipped persona in place rather than appending the edit', () => {
    const store = savePersona({}, draft({ id: 'margaret', name: 'Margaret, 71' }))
    const people = listPersonas(store)

    expect(people).toHaveLength(DEFAULT_PERSONAS.length)
    expect(people[0]!.id).toBe('margaret')
    expect(people[0]!.name).toBe('Margaret, 71')
  })

  it('puts custom people after the shipped ones', () => {
    const store = savePersona({}, draft())
    expect(listPersonas(store).at(-1)!.name).toBe('Priya, 31')
  })
})

describe('resolvePersona', () => {
  it('prefers a stored persona over the shipped one with the same id', () => {
    const store = savePersona({}, draft({ id: 'dani', patience: 'high' }))
    expect(resolvePersona('dani', store)!.patience).toBe('high')
    expect(resolvePersona('dani', {})!.patience).toBe('low')
  })

  it('returns nothing for a persona that was deleted', () => {
    expect(resolvePersona('priya-31', {})).toBeUndefined()
  })
})

describe('forgetPersona', () => {
  // The reason the store holds deltas rather than the whole cast: an edit to a
  // shipped persona has to be undoable, and a shipped persona cannot be lost.
  it('restores the shipped wording when an edited default is forgotten', () => {
    const edited = savePersona({}, draft({ id: 'ruth', name: 'Ruth, 45' }))
    expect(isEdited('ruth', edited)).toBe(true)

    const reset = forgetPersona(edited, 'ruth')
    expect(isEdited('ruth', reset)).toBe(false)
    expect(resolvePersona('ruth', reset)).toEqual(DEFAULT_PERSONAS.find((p) => p.id === 'ruth'))
  })

  it('removes a custom persona from the list entirely', () => {
    const store = savePersona({}, draft())
    const after = forgetPersona(store, 'priya-31')
    expect(listPersonas(after).map((p) => p.id)).toEqual(DEFAULT_PERSONAS.map((p) => p.id))
  })

  it('does not mutate the store it was given', () => {
    const store = savePersona({}, draft())
    forgetPersona(store, 'priya-31')
    expect(store['priya-31']).toBeDefined()
  })
})

describe('makePersonaId', () => {
  it('slugs the name, because an id is read in stored sessions', () => {
    expect(makePersonaId('Priya, 31', {})).toBe('priya-31')
  })

  it('never collides with a shipped id', () => {
    expect(makePersonaId('Margaret, 68', {})).toBe('margaret-68')
    expect(makePersonaId('margaret', {})).toBe('margaret-2')
  })

  it('walks past ids already taken in the store', () => {
    const store: PersonaStore = { 'priya-31': draft() as never, 'priya-31-2': draft() as never }
    expect(makePersonaId('Priya, 31', store)).toBe('priya-31-3')
  })

  it('falls back to a usable id when the name has no letters in it', () => {
    expect(makePersonaId('!!!', {})).toBe('person')
  })
})

describe('savePersona', () => {
  it('keeps the id across a rename, so old runs stay interpretable', () => {
    const first = savePersona({}, draft())
    const renamed = savePersona(first, { ...draft({ name: 'Priya, 32' }), id: 'priya-31' })
    expect(Object.keys(renamed)).toEqual(['priya-31'])
    expect(renamed['priya-31']!.name).toBe('Priya, 32')
  })

  it('marks everything it stores as the developer’s own', () => {
    expect(savePersona({}, draft())['priya-31']!.custom).toBe(true)
  })
})

describe('duplicatePersona', () => {
  it('copies a shipped persona onto a fresh id', () => {
    const copy = duplicatePersona({}, DEFAULT_PERSONAS[0]!)
    expect(copy.id).not.toBe('margaret')
    expect(copy.name).toBe('Margaret, 68 (copy)')
    expect(copy.quirks).toEqual(DEFAULT_PERSONAS[0]!.quirks)
  })

  it('does not alias the source arrays', () => {
    const copy = duplicatePersona({}, DEFAULT_PERSONAS[0]!)
    copy.quirks.push('something else')
    expect(DEFAULT_PERSONAS[0]!.quirks).not.toContain('something else')
  })
})

describe('normalizePersona', () => {
  it('drops blank lines and duplicate entries from the lists', () => {
    const persona = normalizePersona(
      draft({
        quirks: ['  Reads every word  ', '', 'reads every word', 'Looks for a phone number'],
        unknownWords: ['sync', 'Sync', ' ', 'tenant'],
      }),
    )
    expect(persona.quirks).toEqual(['Reads every word', 'Looks for a phone number'])
    expect(persona.unknownWords).toEqual(['sync', 'tenant'])
  })

  it('clamps fields that get pasted straight into the prompt', () => {
    const persona = normalizePersona(draft({ context: 'x'.repeat(5000) }))
    expect(persona.context).toHaveLength(LIMITS.context)
  })

  it('caps how many quirks reach the prompt', () => {
    const many = Array.from({ length: 50 }, (_, i) => `Rule number ${i}`)
    expect(normalizePersona(draft({ quirks: many })).quirks).toHaveLength(LIMITS.quirks)
  })

  it('repairs out-of-range values rather than refusing them', () => {
    // These come from selects, so a bad value means an old stored persona or a
    // hand-edited one — a working persona beats an error about an invisible field.
    const persona = normalizePersona(
      draft({ techLevel: 9 as never, patience: 'glacial' as never, device: '' as never }),
    )
    expect(persona.techLevel).toBe(5)
    expect(persona.patience).toBe('medium')
    expect(persona.device).toBe('desktop')
  })
})

describe('validatePersona', () => {
  it('passes a filled-in draft', () => {
    expect(validatePersona(draft())).toEqual({})
  })

  it('asks for the fields the prompt cannot work without', () => {
    const problems = validatePersona(
      draft({ name: '  ', context: '', motivation: '', quirks: ['', '  '] }),
    )
    expect(Object.keys(problems).sort()).toEqual(['context', 'motivation', 'name', 'quirks'])
  })

  it('accepts a persona who knows every word', () => {
    expect(validatePersona(draft({ unknownWords: [] }))).toEqual({})
  })
})

// Everything the options page and the panel hand to this module has been
// through a `ref`, which means it arrives as a reactive proxy. `structuredClone`
// throws `DataCloneError` on one of those, which is how the editor came to
// vanish the moment it was opened rather than render.
describe('personas that arrive from a Vue ref', () => {
  it('copies a draft held in a ref instead of throwing', () => {
    const editing = ref(draft())
    expect(() => copyPersona(editing.value)).not.toThrow()
    expect(copyPersona(editing.value).name).toBe('Priya, 31')
  })

  it('copies the lists rather than aliasing the reactive ones', () => {
    const editing = ref(draft())
    const copy = copyPersona(editing.value)
    copy.quirks.push('added later')
    expect(editing.value.quirks).toHaveLength(1)
  })

  it('duplicates a reactive persona', () => {
    const people = ref(DEFAULT_PERSONAS)
    expect(() => duplicatePersona({}, people.value[0]!)).not.toThrow()
  })

  it('hands storage plain data even when the store was reactive', () => {
    const store = reactive(savePersona({}, draft()))
    // The real assertion: chrome.storage serializes what it is given, and a
    // proxy does not survive that.
    expect(() => structuredClone(savePersona(store, draft({ name: 'Sam, 40' })))).not.toThrow()
    expect(() => structuredClone(forgetPersona(store, 'priya-31'))).not.toThrow()
  })
})
