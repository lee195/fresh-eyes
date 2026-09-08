// Turning a capture and a persona into something a model can answer.
//
// The page is rendered as compact indented text rather than JSON. Two reasons:
// JSON of 400 nodes spends a third of its tokens on punctuation and repeated
// key names, and models attend better to an outline that reads like a page than
// to an array of objects that reads like a database.
import type { Capture, CapturedNode, Persona } from './types'
import { CAUSES, FEELINGS, USER_ACTIONS } from './types'
import { signalStatements } from './grounding'

export interface AnalysisRequest {
  persona: Persona
  goal: string
  captures: Capture[]
}

export function buildSystemPrompt(): string {
  return `You are simulating one specific non-technical person using a website, and reporting what they think and do.

You are not a usability consultant and you are not writing a report. You are that person. Everything you write as a "quote" is what they would actually say out loud — in their words, at their reading level, with their assumptions intact. A person who does not know the word "dashboard" does not say "the dashboard is unclear"; they say "I don't know what this page is for."

Rules that matter more than fluency:

1. React only to what is in the PAGE section. If something is not listed there, this person cannot see it. Do not assume a cookie banner, a menu, a logo, a back button or a footer exists.
2. Every reaction must quote, in "evidence", text copied exactly from the PAGE section. Copy it; do not paraphrase it. If you cannot find text to quote, you are inventing the reaction — leave it out.
3. Order reactions by what this person notices, not by where things sit in the markup. People read the biggest thing first, then whatever is near where they expect to act. Most people never scroll past the first screen unless something pulls them.
4. Be willing to end it. If this person would close the tab, say so and stop reacting. A run where a confused first-timer sails through every step is not a useful run — it means you were being polite instead of honest.
5. One reaction per thing they actually notice. Five reactions that each name a real moment beat twenty that restate the same confusion.

"action" is what they physically do next, from this fixed list:
${USER_ACTIONS.join(', ')}

"feeling" is one of: ${FEELINGS.join(', ')}
"cause" is one of: ${CAUSES.join(', ')}

"severity" is 1–5 by how much it threatens the goal, not by how annoying it is: 1 is a shrug, 5 is why they left.

Then give a verdict: did this person finish what they came to do, finish it while suffering, or give up. Answer as the outcome of these specific reactions, not as a general impression of the page.`
}

export function buildUserPrompt(req: AnalysisRequest): string {
  const { persona, goal, captures } = req
  const sections: string[] = []

  sections.push(
    `THE PERSON
${persona.name}. ${persona.context}
Comfort with technology: ${persona.techLevel} out of 5.
Patience: ${persona.patience}. On: ${persona.device}.
Why they are here: ${persona.motivation}
How they behave:
${persona.quirks.map((q) => `- ${q}`).join('\n')}
Words they do not know the meaning of: ${persona.unknownWords.join(', ')}`,
  )

  sections.push(`WHAT THEY ARE TRYING TO DO\n${goal}`)

  for (const [index, capture] of captures.entries()) {
    const label = captures.length > 1 ? `PAGE ${index + 1} of ${captures.length}` : 'PAGE'
    sections.push(`${label} — "${capture.title}"
Screen is ${capture.viewport.w}×${capture.viewport.h}. The page is ${capture.viewport.pageHeight} tall, so ${
      capture.viewport.pageHeight > capture.viewport.h * 1.2
        ? 'there is more below the fold they may never see'
        : 'it all fits on one screen'
    }.

${renderNodes(capture)}`)

    const signals = signalStatements(capture)
    if (signals.length) {
      sections.push(
        `HOW THE PAGE BEHAVED\n${signals.map((s) => `- ${s}`).join('\n')}\n\nThese are things this person would feel rather than read. You may quote them in "evidence" exactly as written above.`,
      )
    }
  }

  sections.push(
    `Now answer as ${persona.name}. Use the element ids in [brackets] as "anchorId" so each reaction is pinned to the thing that caused it. Use null only when the reaction is about the page as a whole.`,
  )

  return sections.join('\n\n')
}

/**
 * The page as an outline.
 *
 * Nesting follows the captured parent links, so a field and its label sit
 * together and a person reading top to bottom meets things in the order the
 * page presents them.
 */
function renderNodes(capture: Capture): string {
  const byParent = new Map<string | null, CapturedNode[]>()
  const known = new Set(capture.nodes.map((n) => n.id))

  for (const node of capture.nodes) {
    // A parent may have been dropped by the node budget; reattach to the root
    // rather than losing the child entirely.
    const parent = node.parentId && known.has(node.parentId) ? node.parentId : null
    const siblings = byParent.get(parent) ?? []
    siblings.push(node)
    byParent.set(parent, siblings)
  }

  const lines: string[] = []
  const walk = (parentId: string | null, depth: number): void => {
    for (const node of byParent.get(parentId) ?? []) {
      lines.push(`${'  '.repeat(depth)}${describe(node)}`)
      walk(node.id, depth + 1)
    }
  }
  walk(null, 0)

  const below = capture.nodes.filter((n) => n.fold === 'below').length
  if (below > 0) {
    lines.push('', `(${below} of the items above are below the fold — they must scroll to see them.)`)
  }

  return lines.join('\n')
}

function describe(node: CapturedNode): string {
  const parts = [`[${node.id}]`, node.role]

  if (node.name) parts.push(`"${node.name}"`)
  else if (node.interactive) parts.push('(no label)')

  if (node.text && node.text !== node.name) parts.push(`— ${node.text}`)

  const flags: string[] = []
  if (node.state?.inputType) flags.push(node.state.inputType)
  if (node.state?.required) flags.push('required')
  if (node.state?.hasLabel === false) flags.push('no label attached')
  if (node.state?.placeholder) flags.push(`placeholder "${node.state.placeholder}"`)
  if (node.state?.validationMessage) flags.push(`error "${node.state.validationMessage}"`)
  if (node.state?.disabled) flags.push('disabled')
  if (node.style.looksClickable) flags.push('looks clickable but cannot be focused')
  if (node.style.fontSizePx > 0 && node.style.fontSizePx <= 11) flags.push(`${node.style.fontSizePx}px text`)
  if (node.style.contrastRatio !== undefined && node.style.contrastRatio < 3) {
    flags.push(`very faint (${node.style.contrastRatio}:1)`)
  }
  if (node.fold === 'below') flags.push('below the fold')

  if (flags.length) parts.push(`{${flags.join(', ')}}`)

  return parts.join(' ')
}
