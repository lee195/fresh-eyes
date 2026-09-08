// jsdom does no layout, so every rect would be 0×0 and the visibility filter
// would reject the whole page. The stub below gives each element a plausible
// box, honouring the two CSS properties the filter actually reads. That keeps
// the walk itself — pruning, naming, redaction, dead-click detection — testable
// without a real browser.
import { beforeEach, describe, expect, it } from 'vitest'
import {
  accessibleName,
  buildCapture,
  formState,
  ownText,
  pathOf,
  priorityOf,
} from '@/content/capture'

function fakeRect(y: number, w = 200, h = 20): DOMRect {
  return {
    x: 0,
    y,
    width: w,
    height: h,
    top: y,
    left: 0,
    right: w,
    bottom: y + h,
    toJSON: () => ({}),
  } as DOMRect
}

beforeEach(() => {
  document.body.innerHTML = ''
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    const cs = getComputedStyle(this)
    if (cs.display === 'none' || cs.visibility === 'hidden') return fakeRect(0, 0, 0)
    return fakeRect(Number(this.getAttribute('data-test-y') ?? 10))
  }
})

describe('buildCapture', () => {
  it('leaves out anything a person could not see', () => {
    document.body.innerHTML = `
      <h1>Visible heading</h1>
      <div style="display:none"><button>Hidden button</button></div>
      <p style="visibility:hidden">Invisible copy</p>
      <p aria-hidden="true">Decorative</p>
    `
    const text = JSON.stringify(buildCapture().nodes)
    expect(text).toContain('Visible heading')
    expect(text).not.toContain('Hidden button')
    expect(text).not.toContain('Invisible copy')
    expect(text).not.toContain('Decorative')
  })

  it('never captures what was typed into a form', () => {
    // The dev is testing their own signup form, so the values in it are their
    // own real email and a real test card. Labels and types are what the
    // analysis needs; the values are the one thing that could hurt someone.
    document.body.innerHTML = `
      <label for="e">Email</label><input id="e" type="email" />
      <input id="p" type="password" />
    `
    const email = document.getElementById('e') as HTMLInputElement
    const password = document.getElementById('p') as HTMLInputElement
    email.value = 'jisu.lee@seibert.group'
    password.value = 'hunter2-correct-horse'

    const serialised = JSON.stringify(buildCapture())
    expect(serialised).not.toContain('jisu.lee@seibert.group')
    expect(serialised).not.toContain('hunter2')
    expect(serialised).toContain('Email') // the label still comes through
  })

  it('reports a password field without carrying anything from it', () => {
    document.body.innerHTML = `<input id="p" type="password" placeholder="Your password" required />`
    const state = formState(document.getElementById('p')!)
    expect(state).toEqual({ inputType: 'password', required: true, hasLabel: false })
  })

  it('counts controls that look clickable but cannot be reached', () => {
    document.body.innerHTML = `
      <div style="cursor:pointer">Initialize</div>
      <button style="cursor:pointer">Real button</button>
    `
    const { signals, nodes } = buildCapture()
    expect(signals.fakeClickables).toBe(1)

    const fake = nodes.find((n) => n.text === 'Initialize')
    expect(fake?.style.looksClickable).toBe(true)
    expect(fake?.interactive).toBe(false)
  })

  it('redacts sensitive strings that reached the page as text', () => {
    document.body.innerHTML = `<p>Receipt sent to buyer@example.com</p>`
    const node = buildCapture().nodes.find((n) => n.text.includes('Receipt'))
    expect(node?.text).toBe('Receipt sent to [email]')
  })

  it('marks what is below the first screenful', () => {
    document.body.innerHTML = `
      <h1 data-test-y="20">Top</h1>
      <h2 data-test-y="4000">Far down</h2>
    `
    const nodes = buildCapture().nodes
    expect(nodes.find((n) => n.text === 'Top')?.fold).toBe('above')
    expect(nodes.find((n) => n.text === 'Far down')?.fold).toBe('below')
  })

  it('refuses to describe a tab that is not being rendered', () => {
    // Every element in a collapsed or minimised window measures 0×0, so the
    // visibility filter would drop the whole page and the analysis would go on
    // to describe a blank screen with complete confidence.
    document.body.innerHTML = `<h1>Real content</h1>`
    const width = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { value: 0, configurable: true })
    try {
      expect(() => buildCapture()).toThrow(/not being rendered/)
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
    }
  })

  it('does not repeat a button label as a separate text node', () => {
    document.body.innerHTML = `<button><span>Create my account</span></button>`
    const withLabel = buildCapture().nodes.filter((n) => n.name === 'Create my account')
    const asText = buildCapture().nodes.filter((n) => n.text === 'Create my account')
    expect(withLabel).toHaveLength(1)
    expect(asText).toHaveLength(0)
  })
})

describe('pathOf', () => {
  it('produces a selector that finds the element again', () => {
    document.body.innerHTML = `
      <main><section><p>one</p><p id="target">two</p></section></main>
    `
    const target = document.getElementById('target')!
    expect(document.querySelector(pathOf(target))).toBe(target)
  })
})

describe('accessibleName', () => {
  it('reads a label bound by for=', () => {
    document.body.innerHTML = `<label for="e">Your email address</label><input id="e" />`
    expect(accessibleName(document.getElementById('e')!)).toBe('Your email address')
  })

  it('prefers aria-label over surrounding text', () => {
    document.body.innerHTML = `<button aria-label="Close dialog">×</button>`
    expect(accessibleName(document.querySelector('button')!)).toBe('Close dialog')
  })

  it('reports an unlabelled field as having no name', () => {
    // A placeholder is not a label — it vanishes the moment you type, which is
    // exactly when a non-technical user needs it most.
    document.body.innerHTML = `<input placeholder="Email" />`
    expect(accessibleName(document.querySelector('input')!)).toBe('')
  })
})

describe('ownText', () => {
  it('takes only this elementphrase, not its descendants', () => {
    document.body.innerHTML = `<div>Outer <span>inner</span></div>`
    expect(ownText(document.querySelector('div')!)).toBe('Outer')
  })
})

describe('priorityOf', () => {
  it('keeps a button they can see over prose they may never scroll to', () => {
    expect(priorityOf('button', true, 'above')).toBeGreaterThan(priorityOf('text', false, 'below'))
  })

  it('keeps a heading over body text at the same position', () => {
    expect(priorityOf('heading', false, 'above')).toBeGreaterThan(priorityOf('text', false, 'above'))
  })
})
